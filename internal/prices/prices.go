package prices

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"el-costas/internal/domain"
)

const (
	DefaultAMFIURL  = "https://www.amfiindia.com/spages/NAVAll.txt"
	DefaultYahooURL = "https://query1.finance.yahoo.com"

	requestTimeout        = 15 * time.Second
	maxConcurrentRequests = 4
	maxBodyBytes          = 32 << 20
	priceDecimals         = 4
)

var istZone = time.FixedZone("IST", 5*3600+30*60)

// Sources are where prices come from. The URLs are fields so tests can point them at a local server.
type Sources struct {
	AMFIURL  string
	YahooURL string
	Client   *http.Client
}

// Failure is a holding whose price could not be fetched.
type Failure struct {
	Name   string `json:"name"`
	Reason string `json:"reason"`
}

func DefaultSources() Sources {
	return Sources{AMFIURL: DefaultAMFIURL, YahooURL: DefaultYahooURL, Client: &http.Client{Timeout: requestTimeout}}
}

// Fetch looks up current prices by holding id: mutual funds in AMFI's file by scheme code, equity on Yahoo
// Finance by symbol, a few requests at a time. Gold is priced by hand. Holdings that fail are listed, in
// holding order, and keep their last price.
func Fetch(ctx context.Context, src Sources, holdings []domain.Holding, now time.Time) (map[string]domain.Quote, []Failure) {
	type outcome struct {
		quote domain.Quote
		err   error
		done  bool
	}
	outcomes := make([]outcome, len(holdings))

	var funds map[string]domain.Quote
	var fundsErr error
	fundsLoaded := false
	var lookups sync.WaitGroup
	slots := make(chan struct{}, maxConcurrentRequests)

	for i, h := range holdings {
		switch h.Class {
		case domain.ClassMutualFund:
			if h.Ticker == "" {
				outcomes[i] = outcome{err: errors.New("no AMFI scheme code in the ticker field"), done: true}
				continue
			}
			if !fundsLoaded {
				funds, fundsErr = fetchAMFI(ctx, src)
				fundsLoaded = true
			}
			quote, found := funds[h.Ticker]
			switch {
			case fundsErr != nil:
				outcomes[i] = outcome{err: fundsErr, done: true}
			case !found:
				outcomes[i] = outcome{err: fmt.Errorf("scheme code %s is not in AMFI's list; check the AMFI scheme code in the ticker field", h.Ticker), done: true}
			default:
				outcomes[i] = outcome{quote: quote, done: true}
			}
		case domain.ClassEquity:
			if h.Ticker == "" {
				outcomes[i] = outcome{err: errors.New("no symbol in the ticker field"), done: true}
				continue
			}
			lookups.Add(1)
			slots <- struct{}{}
			go func(i int, symbol string) {
				defer lookups.Done()
				defer func() { <-slots }()
				quote, err := fetchYahoo(ctx, src, symbol, now)
				outcomes[i] = outcome{quote: quote, err: err, done: true}
			}(i, h.Ticker)
		}
	}
	lookups.Wait()

	quotes := map[string]domain.Quote{}
	failures := []Failure{}
	for i, h := range holdings {
		switch o := outcomes[i]; {
		case !o.done:
		case o.err != nil:
			failures = append(failures, Failure{Name: h.Name, Reason: o.err.Error()})
		default:
			quotes[h.ID] = o.quote
		}
	}
	return quotes, failures
}

func fetchAMFI(ctx context.Context, src Sources) (map[string]domain.Quote, error) {
	body, err := get(ctx, src.Client, src.AMFIURL)
	if err != nil {
		return nil, fmt.Errorf("AMFI: %w", err)
	}
	defer body.Close()

	quotes := map[string]domain.Quote{}
	priceColumn, dateColumn := -1, -1
	scanner := bufio.NewScanner(io.LimitReader(body, maxBodyBytes))
	for scanner.Scan() {
		fields := strings.Split(strings.TrimSpace(scanner.Text()), ";")
		if strings.EqualFold(strings.TrimSpace(fields[0]), "Scheme Code") {
			priceColumn, dateColumn = columnOf(fields, "Net Asset Value"), columnOf(fields, "Date")
			continue
		}
		if priceColumn < 0 || dateColumn < 0 || len(fields) <= max(priceColumn, dateColumn) || !isCode(fields[0]) {
			continue
		}
		price, err := domain.ParseDecimal(strings.TrimSpace(fields[priceColumn]))
		if err != nil {
			continue
		}
		asOf, err := time.ParseInLocation("02-Jan-2006", strings.TrimSpace(fields[dateColumn]), istZone)
		if err != nil {
			continue
		}
		quotes[fields[0]] = domain.Quote{Price: price, AsOf: asOf, Source: domain.PriceSourceAMFI}
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("AMFI: read list: %w", err)
	}
	if len(quotes) == 0 {
		return nil, errors.New("AMFI: the list had no readable prices; its format may have changed")
	}
	return quotes, nil
}

type yahooChart struct {
	Chart struct {
		Result []struct {
			Meta struct {
				Price json.Number `json:"regularMarketPrice"`
				Time  int64       `json:"regularMarketTime"`
			} `json:"meta"`
		} `json:"result"`
		Error *struct {
			Description string `json:"description"`
		} `json:"error"`
	} `json:"chart"`
}

func fetchYahoo(ctx context.Context, src Sources, symbol string, now time.Time) (domain.Quote, error) {
	endpoint := src.YahooURL + "/v8/finance/chart/" + url.PathEscape(symbol) + "?interval=1d&range=1d"
	body, err := get(ctx, src.Client, endpoint)
	if err != nil {
		var status statusError
		if errors.As(err, &status) && status.code == http.StatusNotFound {
			return domain.Quote{}, fmt.Errorf("Yahoo Finance has no symbol %q; check the ticker, for example RELIANCE.NS", symbol)
		}
		return domain.Quote{}, fmt.Errorf("Yahoo Finance: %w", err)
	}
	defer body.Close()

	var chart yahooChart
	decoder := json.NewDecoder(io.LimitReader(body, maxBodyBytes))
	decoder.UseNumber()
	if err := decoder.Decode(&chart); err != nil {
		return domain.Quote{}, fmt.Errorf("Yahoo Finance: unreadable answer: %w", err)
	}
	if chart.Chart.Error != nil {
		return domain.Quote{}, fmt.Errorf("Yahoo Finance: %s", chart.Chart.Error.Description)
	}
	if len(chart.Chart.Result) == 0 {
		return domain.Quote{}, fmt.Errorf("Yahoo Finance: no data for %s", symbol)
	}

	meta := chart.Chart.Result[0].Meta
	price, err := domain.ParseDecimal(trimPlaces(meta.Price.String(), priceDecimals))
	if err != nil || price.IsZero() {
		return domain.Quote{}, fmt.Errorf("Yahoo Finance: no usable price for %s", symbol)
	}
	asOf := now
	if meta.Time > 0 {
		asOf = time.Unix(meta.Time, 0).UTC()
	}
	return domain.Quote{Price: price, AsOf: asOf, Source: domain.PriceSourceYahoo}, nil
}

type statusError struct {
	status string
	code   int
}

func (e statusError) Error() string {
	return "server answered " + e.status
}

func get(ctx context.Context, client *http.Client, endpoint string) (io.ReadCloser, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("User-Agent", "El Costas price check")
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("could not connect: %w", err)
	}
	if response.StatusCode != http.StatusOK {
		response.Body.Close()
		return nil, statusError{status: response.Status, code: response.StatusCode}
	}
	return response.Body, nil
}

func columnOf(header []string, name string) int {
	for i, column := range header {
		if strings.EqualFold(strings.TrimSpace(column), name) {
			return i
		}
	}
	return -1
}

func isCode(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// trimPlaces cuts a plain decimal to at most the given number of places, e.g. Yahoo's 1234.5500488281.
func trimPlaces(s string, places int) string {
	whole, fraction, hasPoint := strings.Cut(s, ".")
	if hasPoint && len(fraction) > places {
		fraction = fraction[:places]
	}
	if hasPoint && fraction != "" {
		return whole + "." + fraction
	}
	return whole
}
