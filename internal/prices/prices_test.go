package prices

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"fingeist/internal/domain"
)

const amfiList = "Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date\r\n" +
	" \r\n" +
	"Open Ended Schemes(Equity Scheme - Large Cap Fund)\r\n" +
	" \r\n" +
	"Aditya Birla Sun Life Mutual Fund\r\n" +
	" \r\n" +
	"119551;INF209KA12Z1;INF209KA13Z9;Aditya Birla Sun Life Banking & PSU Debt Fund;Direct Plan;Growth Option;355.1234;07-Nov-2026\r\n" +
	"120503;INF846K01EW2;-;Axis Equity Fund;Direct Plan;Growth;55.1;06-Nov-2026\r\n" +
	"100001;-;-;Suspended Fund;Regular Plan;Growth;N.A.;07-Nov-2026\r\n" +
	"100002;-;-;Bad Date Fund;Regular Plan;Growth;10.5;someday\r\n"

// The list as it was before AMFI added the Plan and Option columns.
const amfiListOlder = "Scheme Code;ISIN Div Payout/ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date\r\n" +
	"119551;INF209KA12Z1;INF209KA13Z9;Aditya Birla Sun Life Banking & PSU Debt Fund;355.1234;07-Nov-2026\r\n"

const yahooAnswer = `{"chart":{"result":[{"meta":{"currency":"INR","symbol":"ACME.NS","regularMarketPrice":1234.5500488281,"regularMarketTime":1794139800}}],"error":null}}`

var now = time.Date(2026, 11, 8, 12, 0, 0, 0, time.UTC)

func holding(id string, class domain.AssetClass, ticker string) domain.Holding {
	return domain.Holding{ID: id, Class: class, Name: "Name " + id, Ticker: ticker}
}

func server(t *testing.T, handler http.HandlerFunc) Sources {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	return Sources{AMFIURL: srv.URL + "/NAVAll.txt", YahooURL: srv.URL, Client: srv.Client()}
}

func TestFetchMutualFundsFromAMFI(t *testing.T) {
	var requests atomic.Int32
	src := server(t, func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		w.Write([]byte(amfiList))
	})

	holdings := []domain.Holding{
		holding("a", domain.ClassMutualFund, "119551"),
		holding("b", domain.ClassMutualFund, "120503"),
		holding("c", domain.ClassMutualFund, "999999"),
		holding("d", domain.ClassMutualFund, "100001"),
		holding("e", domain.ClassMutualFund, ""),
	}
	quotes, failures := Fetch(context.Background(), src, holdings, now)

	if requests.Load() != 1 {
		t.Fatalf("AMFI requested %d times, want once for all funds", requests.Load())
	}
	if got := quotes["a"]; got.Price.String() != "355.1234" || got.Source != "amfi" || got.AsOf.Format(time.RFC3339) != "2026-11-07T00:00:00+05:30" {
		t.Fatalf("quote a = %+v", got)
	}
	if got := quotes["b"]; got.Price.String() != "55.1" {
		t.Fatalf("quote b = %+v", got)
	}
	if len(quotes) != 2 || len(failures) != 3 {
		t.Fatalf("quotes = %d, failures = %+v", len(quotes), failures)
	}
}

func TestFetchEquityFromYahoo(t *testing.T) {
	var path, agent string
	src := server(t, func(w http.ResponseWriter, r *http.Request) {
		path, agent = r.URL.RequestURI(), r.Header.Get("User-Agent")
		w.Write([]byte(yahooAnswer))
	})

	quotes, failures := Fetch(context.Background(), src, []domain.Holding{holding("a", domain.ClassEquity, "ACME.NS")}, now)
	if len(failures) != 0 {
		t.Fatalf("failures = %+v", failures)
	}
	got := quotes["a"]
	if got.Price.String() != "1234.5500" || got.Source != "yahoo" || got.AsOf.Unix() != 1794139800 {
		t.Fatalf("quote = %+v", got)
	}
	if path != "/v8/finance/chart/ACME.NS?interval=1d&range=1d" || agent == "" {
		t.Fatalf("path = %q, user agent = %q", path, agent)
	}
}

func TestFetchEscapesSymbols(t *testing.T) {
	var path string
	src := server(t, func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.EscapedPath()
		w.Write([]byte(yahooAnswer))
	})
	Fetch(context.Background(), src, []domain.Holding{holding("a", domain.ClassEquity, "M&M/X.NS")}, now)
	if path != "/v8/finance/chart/M&M%2FX.NS" {
		t.Fatalf("path = %q", path)
	}
}

func TestFetchSkipsGoldAndEmptyLists(t *testing.T) {
	src := server(t, func(w http.ResponseWriter, r *http.Request) {
		t.Error("no request expected")
	})
	quotes, failures := Fetch(context.Background(), src, []domain.Holding{holding("g", domain.ClassGold, "")}, now)
	if len(quotes) != 0 || len(failures) != 0 {
		t.Fatalf("quotes = %v, failures = %v", quotes, failures)
	}
	quotes, failures = Fetch(context.Background(), src, nil, now)
	if len(quotes) != 0 || len(failures) != 0 {
		t.Fatal("nothing to fetch")
	}
}

func TestFetchFailuresAreReportedPerHolding(t *testing.T) {
	tests := []struct {
		name    string
		handler http.HandlerFunc
	}{
		{"server error", func(w http.ResponseWriter, r *http.Request) { http.Error(w, "boom", http.StatusInternalServerError) }},
		{"not found", func(w http.ResponseWriter, r *http.Request) { http.NotFound(w, r) }},
		{"garbage json", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("<html>")) }},
		{"yahoo error body", func(w http.ResponseWriter, r *http.Request) {
			w.Write([]byte(`{"chart":{"result":null,"error":{"code":"Not Found","description":"No data found"}}}`))
		}},
		{"no results", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(`{"chart":{"result":[],"error":null}}`)) }},
		{"zero price", func(w http.ResponseWriter, r *http.Request) {
			w.Write([]byte(`{"chart":{"result":[{"meta":{"regularMarketPrice":0}}],"error":null}}`))
		}},
		{"exponent price", func(w http.ResponseWriter, r *http.Request) {
			w.Write([]byte(`{"chart":{"result":[{"meta":{"regularMarketPrice":1e21}}],"error":null}}`))
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			src := server(t, tt.handler)
			holdings := []domain.Holding{holding("a", domain.ClassEquity, "ACME.NS"), holding("b", domain.ClassMutualFund, "119551")}
			quotes, failures := Fetch(context.Background(), src, holdings, now)
			if len(quotes) != 0 || len(failures) != 2 || failures[0].Reason == "" || failures[0].Name != "Name a" {
				t.Fatalf("quotes = %v, failures = %+v", quotes, failures)
			}
		})
	}
}

func TestFetchOneFailureDoesNotStopTheOthers(t *testing.T) {
	src := server(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/NAVAll.txt" {
			http.Error(w, "down", http.StatusBadGateway)
			return
		}
		w.Write([]byte(yahooAnswer))
	})
	holdings := []domain.Holding{holding("fund", domain.ClassMutualFund, "119551"), holding("stock", domain.ClassEquity, "ACME.NS")}
	quotes, failures := Fetch(context.Background(), src, holdings, now)
	if _, ok := quotes["stock"]; !ok || len(quotes) != 1 || len(failures) != 1 || failures[0].Name != "Name fund" {
		t.Fatalf("quotes = %v, failures = %+v", quotes, failures)
	}
}

func TestFetchTimeoutAndOffline(t *testing.T) {
	slow := server(t, func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-time.After(2 * time.Second):
		case <-r.Context().Done():
		}
	})
	slow.Client = &http.Client{Timeout: 50 * time.Millisecond}
	started := time.Now()
	quotes, failures := Fetch(context.Background(), slow, []domain.Holding{holding("a", domain.ClassEquity, "ACME.NS")}, now)
	if len(quotes) != 0 || len(failures) != 1 || time.Since(started) > time.Second {
		t.Fatalf("quotes = %v, failures = %+v, took %v", quotes, failures, time.Since(started))
	}

	offline := Sources{AMFIURL: "http://127.0.0.1:1/NAVAll.txt", YahooURL: "http://127.0.0.1:1", Client: &http.Client{Timeout: time.Second}}
	holdings := []domain.Holding{holding("a", domain.ClassEquity, "ACME.NS"), holding("b", domain.ClassMutualFund, "119551")}
	quotes, failures = Fetch(context.Background(), offline, holdings, now)
	if len(quotes) != 0 || len(failures) != 2 {
		t.Fatalf("offline: quotes = %v, failures = %+v", quotes, failures)
	}
}

func TestFetchCancelledContext(t *testing.T) {
	src := server(t, func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(yahooAnswer)) })
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	quotes, failures := Fetch(ctx, src, []domain.Holding{holding("a", domain.ClassEquity, "ACME.NS")}, now)
	if len(quotes) != 0 || len(failures) != 1 {
		t.Fatalf("quotes = %v, failures = %+v", quotes, failures)
	}
}

func TestTrimPlaces(t *testing.T) {
	tests := map[string]string{
		"1234.5500488281": "1234.5500",
		"12.5":            "12.5",
		"12":              "12",
		"12.":             "12",
		"0.00001":         "0.0000",
	}
	for in, want := range tests {
		if got := trimPlaces(in, 4); got != want {
			t.Errorf("trimPlaces(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestFetchEquityRunsAFewRequestsAtATimeAndKeepsOrder(t *testing.T) {
	var running, peak atomic.Int32
	src := server(t, func(w http.ResponseWriter, r *http.Request) {
		now := running.Add(1)
		defer running.Add(-1)
		for {
			seen := peak.Load()
			if now <= seen || peak.CompareAndSwap(seen, now) {
				break
			}
		}
		time.Sleep(60 * time.Millisecond)
		if strings.Contains(r.URL.Path, "BAD") {
			http.NotFound(w, r)
			return
		}
		w.Write([]byte(yahooAnswer))
	})

	var holdings []domain.Holding
	for i := 0; i < 12; i++ {
		ticker := fmt.Sprintf("OK%d.NS", i)
		if i%5 == 0 {
			ticker = fmt.Sprintf("BAD%d.NS", i)
		}
		holdings = append(holdings, holding(fmt.Sprintf("%02d", i), domain.ClassEquity, ticker))
	}

	started := time.Now()
	quotes, failures := Fetch(context.Background(), src, holdings, now)

	if peak.Load() < 2 || peak.Load() > maxConcurrentRequests {
		t.Errorf("peak concurrent requests = %d, want between 2 and %d", peak.Load(), maxConcurrentRequests)
	}
	if elapsed := time.Since(started); elapsed > 500*time.Millisecond {
		t.Errorf("took %v; twelve 60ms lookups at four a time should take about 200ms", elapsed)
	}
	if len(quotes) != 9 || len(failures) != 3 {
		t.Fatalf("quotes = %d, failures = %+v", len(quotes), failures)
	}
	if failures[0].Name != "Name 00" || failures[1].Name != "Name 05" || failures[2].Name != "Name 10" {
		t.Errorf("failures must follow holding order: %+v", failures)
	}
}

func TestFetchAMFIFindsColumnsFromTheHeader(t *testing.T) {
	tests := []struct {
		name, list, wantPrice string
		wantErr               bool
	}{
		{"current eight-column list", amfiList, "355.1234", false},
		{"older six-column list", amfiListOlder, "355.1234", false},
		{"columns in another order", "Scheme Code;Date;Net Asset Value;Scheme Name\r\n119551;07-Nov-2026;12.34;Some Fund\r\n", "12.34", false},
		{"no header", "119551;INF1;-;Fund;Direct;Growth;12.34;07-Nov-2026\r\n", "", true},
		{"header without a price column", "Scheme Code;Scheme Name;Date\r\n119551;Fund;07-Nov-2026\r\n", "", true},
		{"html instead of the list", "<html><body>Access denied</body></html>", "", true},
		{"empty", "", "", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			src := server(t, func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(tt.list)) })
			quotes, err := fetchAMFI(context.Background(), src)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("got %d quotes and no error, want an error", len(quotes))
				}
				return
			}
			if err != nil || quotes["119551"].Price.String() != tt.wantPrice {
				t.Fatalf("got %+v, %v; want price %s", quotes["119551"], err, tt.wantPrice)
			}
		})
	}
}

func TestFetchExplainsAWrongTicker(t *testing.T) {
	src := server(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/NAVAll.txt" {
			w.Write([]byte(amfiList))
			return
		}
		http.NotFound(w, r)
	})
	holdings := []domain.Holding{
		holding("fund", domain.ClassMutualFund, "000000"),
		holding("stock", domain.ClassEquity, "NOPE.NS"),
		holding("noticker", domain.ClassEquity, ""),
	}
	_, failures := Fetch(context.Background(), src, holdings, now)
	if len(failures) != 3 {
		t.Fatalf("failures = %+v", failures)
	}
	for i, want := range []string{"AMFI scheme code in the ticker field", `no symbol "NOPE.NS"`, "no symbol in the ticker field"} {
		if !strings.Contains(failures[i].Reason, want) {
			t.Errorf("failure %d = %q, want it to mention %q", i, failures[i].Reason, want)
		}
	}
}
