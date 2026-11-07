package storage

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	_ "time/tzdata"

	"el-costas/internal/domain"
)

const csvHeader = "id,time,amount,category,merchant,note,tags\n"

func writeCSV(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "transactions.csv")
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func mustLocation(t *testing.T, name string) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation(name)
	if err != nil {
		t.Fatal(err)
	}
	return loc
}

func TestLoadV1Fixture(t *testing.T) {
	loaded, err := Load(filepath.Join("testdata", "v1.csv"), 2, time.UTC)
	if err != nil {
		t.Fatal(err)
	}
	_, offset := loaded.Transactions[0].Time.Zone()
	want := domain.Transaction{
		ID: "01A", Time: loaded.Transactions[0].Time, Amount: -12000,
		Category: "groceries", Merchant: "Market", Tags: []string{"food", "weekly"},
	}
	if len(loaded.Transactions) != 1 || !reflect.DeepEqual(loaded.Transactions[0], want) || offset != 5*3600+30*60 {
		t.Fatalf("got %+v (offset %d)", loaded.Transactions, offset)
	}
	if len(loaded.Problems) != 0 || loaded.Hash == "" {
		t.Fatalf("problems = %v, hash = %q", loaded.Problems, loaded.Hash)
	}
}

func TestLoadInputShapes(t *testing.T) {
	tests := []struct {
		name         string
		content      string
		wantCount    int
		wantProblems []Problem
	}{
		{"empty file", "", 0, nil},
		{"whitespace only", "\n\n", 0, nil},
		{"header only", csvHeader, 0, nil},
		{"header only CRLF", strings.ReplaceAll(csvHeader, "\n", "\r\n"), 0, nil},
		{"BOM and header only", "\xEF\xBB\xBF" + csvHeader, 0, nil},
		{"BOM CRLF with rows", "\xEF\xBB\xBF" + strings.ReplaceAll(csvHeader+"a,2026-01-02,-1.50,,,,\n", "\n", "\r\n"), 1, nil},
		{"no trailing newline", csvHeader + "a,2026-01-02,-1.50,,,,", 1, nil},
		{"blank lines skipped", csvHeader + "\na,2026-01-02,-1.50,,,,\n\n", 1, nil},
		{"quoted fields with commas and newlines", csvHeader + "a,2026-01-02,-1.50,,\"Smith, J\",\"two\nlines\",\n", 1, nil},
		{
			"bad amount keeps other rows",
			csvHeader + "a,2026-01-02,-1.50,,,,\nb,2026-01-03,abc,,,,\nc,2026-01-04,2.00,,,,\n",
			2, []Problem{{Line: 3, Message: `invalid amount: "abc"`}},
		},
		{
			"too many decimals",
			csvHeader + "a,2026-01-02,-1.505,,,,\n",
			0, []Problem{{Line: 2, Message: `invalid amount: "-1.505"`}},
		},
		{
			"bad time",
			csvHeader + "a,yesterday,-1.50,,,,\n",
			0, []Problem{{Line: 2, Message: `invalid time "yesterday": use 2026-11-07T14:30:00+05:30, 2026-11-07 14:30 or 2026-11-07`}},
		},
		{
			"wrong field count",
			csvHeader + "a,2026-01-02,-1.50\n",
			0, []Problem{{Line: 2, Message: "expected 7 fields, got 3"}},
		},
		{
			"duplicate id",
			csvHeader + "a,2026-01-02,-1.50,,,,\na,2026-01-03,-2.00,,,,\n",
			1, []Problem{{Line: 3, Message: `duplicate id "a"`}},
		},
		{
			"bare quote",
			csvHeader + "a,2026-01-02,-1.50,,Bob \"B\" X,,\nb,2026-01-03,-2.00,,,,\n",
			1, []Problem{{Line: 2, Message: `bare " in non-quoted-field`}},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			loaded, err := Load(writeCSV(t, tt.content), 2, time.UTC)
			if err != nil {
				t.Fatal(err)
			}
			if len(loaded.Transactions) != tt.wantCount {
				t.Errorf("got %d transactions, want %d", len(loaded.Transactions), tt.wantCount)
			}
			if !reflect.DeepEqual(loaded.Problems, tt.wantProblems) {
				t.Errorf("problems = %+v, want %+v", loaded.Problems, tt.wantProblems)
			}
		})
	}
}

func TestLoadBadHeader(t *testing.T) {
	for _, content := range []string{"foo,bar\n1,2\n", "id,time,amount\n", "ID,time,amount,category,merchant,note,tags\n"} {
		if _, err := Load(writeCSV(t, content), 2, time.UTC); err == nil {
			t.Errorf("Load(%q) succeeded, want an error", content)
		}
	}
}

func TestLoadMissingFile(t *testing.T) {
	loaded, err := Load(filepath.Join(t.TempDir(), "transactions.csv"), 2, time.UTC)
	if err != nil || len(loaded.Transactions) != 0 || loaded.Hash != "" {
		t.Fatalf("got %+v, %v; want an empty result", loaded, err)
	}
}

func TestLoadBlankIDsGetUniqueIDs(t *testing.T) {
	loaded, err := Load(writeCSV(t, csvHeader+",2026-01-02,-1.50,,,,\n,2026-01-03,-2.00,,,,\n"), 2, time.UTC)
	if err != nil {
		t.Fatal(err)
	}
	a, b := loaded.Transactions[0].ID, loaded.Transactions[1].ID
	if a == "" || b == "" || a == b {
		t.Fatalf("ids = %q, %q", a, b)
	}
}

func TestLoadAmounts(t *testing.T) {
	tests := []struct {
		decimals int
		amount   string
		want     domain.Money
	}{
		{0, "-1500", -1500},
		{2, "-12.5", -1250},
		{2, "+2500.00", 250000},
		{3, "-1.005", -1005},
	}
	for _, tt := range tests {
		loaded, err := Load(writeCSV(t, csvHeader+"a,2026-01-02,"+tt.amount+",,,,\n"), tt.decimals, time.UTC)
		if err != nil || len(loaded.Transactions) != 1 || loaded.Transactions[0].Amount != tt.want {
			t.Errorf("amount %q with %d decimals: got %+v, %v", tt.amount, tt.decimals, loaded, err)
		}
	}
}

func TestParseTime(t *testing.T) {
	newYork := mustLocation(t, "America/New_York")
	tests := []struct {
		name     string
		in       string
		loc      *time.Location
		wantDate string
		wantUTC  string
		wantErr  bool
	}{
		{"offset kept", "2026-11-07T23:30:00-05:00", time.UTC, "2026-11-07", "2026-11-08T04:30:00Z", false},
		{"positive offset kept", "2026-11-07T00:30:00+05:30", time.UTC, "2026-11-07", "2026-11-06T19:00:00Z", false},
		{"zulu", "2026-11-07T10:00:00Z", newYork, "2026-11-07", "2026-11-07T10:00:00Z", false},
		{"fractional seconds", "2026-11-07T10:00:00.250+01:00", time.UTC, "2026-11-07", "2026-11-07T09:00:00.25Z", false},
		{"date only is local midnight", "2026-11-07", newYork, "2026-11-07", "2026-11-07T05:00:00Z", false},
		{"date and minutes", "2026-11-07 14:30", newYork, "2026-11-07", "2026-11-07T19:30:00Z", false},
		{"date T minutes", "2026-11-07T14:30", newYork, "2026-11-07", "2026-11-07T19:30:00Z", false},
		{"summer time uses EDT", "2026-07-01 12:00", newYork, "2026-07-01", "2026-07-01T16:00:00Z", false},
		{"spring forward gap", "2026-03-08 02:30", newYork, "2026-03-08", "", false},
		{"fall back first hour", "2026-11-01 01:30", newYork, "2026-11-01", "", false},
		{"impossible date", "2026-02-30", time.UTC, "", "", true},
		{"garbage", "soon", time.UTC, "", "", true},
		{"empty", "", time.UTC, "", "", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseTime(tt.in, tt.loc)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("parseTime(%q) succeeded, want an error", tt.in)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if date := got.Format("2006-01-02"); date != tt.wantDate {
				t.Errorf("wall-clock date = %s, want %s", date, tt.wantDate)
			}
			if utc := got.UTC().Format(time.RFC3339Nano); tt.wantUTC != "" && utc != tt.wantUTC {
				t.Errorf("UTC = %s, want %s", utc, tt.wantUTC)
			}
		})
	}
}

func TestEncodeAndLoadRoundTrip(t *testing.T) {
	zone := time.FixedZone("", 5*3600+30*60)
	txns := []domain.Transaction{
		{ID: "a", Time: time.Date(2026, 11, 7, 14, 30, 0, 0, zone), Amount: -12000, Category: "groceries", Merchant: "Smith, J", Note: "two\nlines \"quoted\"", Tags: []string{"food", "weekly"}},
		{ID: "b", Time: time.Date(2026, 11, 8, 0, 0, 0, 0, time.UTC), Amount: 250000},
	}
	data, err := encode(txns, 2)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "\r") {
		t.Fatal("output must use LF line endings")
	}

	loaded, err := Load(writeCSV(t, string(data)), 2, time.UTC)
	if err != nil || len(loaded.Problems) != 0 {
		t.Fatalf("load: %v, %v", err, loaded.Problems)
	}
	if len(loaded.Transactions) != 2 {
		t.Fatalf("got %d transactions", len(loaded.Transactions))
	}
	for i, want := range txns {
		got := loaded.Transactions[i]
		if got.ID != want.ID || !got.Time.Equal(want.Time) || got.Amount != want.Amount ||
			got.Category != want.Category || got.Merchant != want.Merchant || got.Note != want.Note ||
			!reflect.DeepEqual(got.Tags, want.Tags) {
			t.Errorf("row %d: got %+v, want %+v", i, got, want)
		}
		if _, offset := got.Time.Zone(); i == 0 && offset != 5*3600+30*60 {
			t.Errorf("offset not preserved: %d", offset)
		}
	}
}
