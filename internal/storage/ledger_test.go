package storage

import (
	"errors"
	"os"
	"strings"
	"testing"
	"time"
)

func openTestLedger(t *testing.T, content string) (*Ledger, string) {
	t.Helper()
	path := writeCSV(t, content)
	l, err := OpenLedger(path, 2, time.UTC)
	if err != nil {
		t.Fatal(err)
	}
	return l, path
}

func TestLedgerAddUpdateDelete(t *testing.T) {
	l, path := openTestLedger(t, csvHeader)

	added, err := l.Add(Fields{ID: "ignored", Time: "2026-01-02", Amount: "-5", Category: "food", Tags: "a; b;"})
	if err != nil {
		t.Fatal(err)
	}
	if added.ID == "" || added.ID == "ignored" || added.Amount != "-5.00" || added.Tags != "a;b" {
		t.Fatalf("added = %+v", added)
	}
	if !strings.Contains(readFile(t, path), added.ID+",2026-01-02T00:00:00Z,-5.00,food,,,a;b\n") {
		t.Fatalf("file = %q", readFile(t, path))
	}

	added.Amount = "-7.25"
	added.Merchant = "Corner shop"
	if err := l.Update(added); err != nil {
		t.Fatal(err)
	}
	if got := l.Rows()[0]; got.Amount != "-7.25" || got.Merchant != "Corner shop" {
		t.Fatalf("row = %+v", got)
	}

	if err := l.Delete(added.ID); err != nil {
		t.Fatal(err)
	}
	if len(l.Rows()) != 0 || readFile(t, path) != csvHeader {
		t.Fatalf("rows = %v, file = %q", l.Rows(), readFile(t, path))
	}
}

func TestLedgerRejectsBadInputWithoutChange(t *testing.T) {
	l, path := openTestLedger(t, csvHeader)
	before := readFile(t, path)

	for _, f := range []Fields{
		{Time: "2026-01-02", Amount: "abc"},
		{Time: "nope", Amount: "1"},
		{Time: "2026-01-02", Amount: "1.999"},
	} {
		if _, err := l.Add(f); err == nil {
			t.Errorf("Add(%+v) succeeded, want an error", f)
		}
	}
	if readFile(t, path) != before || len(l.Rows()) != 0 {
		t.Fatal("invalid input must not change anything")
	}
}

func TestLedgerUnknownID(t *testing.T) {
	l, _ := openTestLedger(t, csvHeader)
	if err := l.Update(Fields{ID: "nope", Time: "2026-01-02", Amount: "1"}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Update error = %v", err)
	}
	if err := l.Delete("nope"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Delete error = %v", err)
	}
}

func TestLedgerRefusesEditsWhileRowsAreMalformed(t *testing.T) {
	content := csvHeader + "a,2026-01-02,-1.50,,,,\nb,oops,-2.00,,,,\n"
	l, path := openTestLedger(t, content)

	if len(l.Problems()) != 1 || l.Problems()[0].Line != 3 {
		t.Fatalf("problems = %+v", l.Problems())
	}
	if _, err := l.Add(Fields{Time: "2026-01-02", Amount: "1"}); !errors.Is(err, ErrMalformedRows) {
		t.Fatalf("Add error = %v", err)
	}
	if err := l.Update(Fields{ID: "a", Time: "2026-01-02", Amount: "1"}); !errors.Is(err, ErrMalformedRows) {
		t.Fatalf("Update error = %v", err)
	}
	if err := l.Delete("a"); !errors.Is(err, ErrMalformedRows) {
		t.Fatalf("Delete error = %v", err)
	}
	if err := l.Save(); !errors.Is(err, ErrMalformedRows) {
		t.Fatalf("Save error = %v", err)
	}
	if readFile(t, path) != content {
		t.Fatal("a file with malformed rows must never be rewritten")
	}
}

func TestLedgerFillsBlankIDsInMemoryAndWritesThemOnSave(t *testing.T) {
	l, path := openTestLedger(t, csvHeader+",2026-01-02,-1.50,,,,\n")
	id := l.Rows()[0].ID
	if id == "" {
		t.Fatal("blank id was not filled in")
	}
	if strings.Contains(readFile(t, path), id) {
		t.Fatal("loading must not rewrite the file")
	}
	if err := l.Save(); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(readFile(t, path), id+",2026-01-02") {
		t.Fatalf("file = %q", readFile(t, path))
	}
}

func TestLedgerExternalChange(t *testing.T) {
	l, path := openTestLedger(t, csvHeader+"a,2026-01-02,-1.50,,,,\n")

	changed, err := l.CheckExternalChange()
	if err != nil || changed {
		t.Fatalf("unchanged file: changed = %v, err = %v", changed, err)
	}

	edited := csvHeader + "a,2026-01-02,-1.50,,,,\nb,2026-01-03,-2.00,,,,\n"
	if err := os.WriteFile(path, []byte(edited), 0o600); err != nil {
		t.Fatal(err)
	}
	changed, err = l.CheckExternalChange()
	if err != nil || !changed || len(l.Rows()) != 2 {
		t.Fatalf("changed = %v, err = %v, rows = %d", changed, err, len(l.Rows()))
	}
}

func TestLedgerSaveAfterExternalChangeReloadsAndDoesNotWrite(t *testing.T) {
	l, path := openTestLedger(t, csvHeader+"a,2026-01-02,-1.50,,,,\n")
	edited := csvHeader + "a,2026-01-02,-1.50,,,,\nb,2026-01-03,-2.00,,,,\n"
	if err := os.WriteFile(path, []byte(edited), 0o600); err != nil {
		t.Fatal(err)
	}

	_, err := l.Add(Fields{Time: "2026-01-04", Amount: "-3"})
	if !errors.Is(err, ErrExternalChange) {
		t.Fatalf("error = %v, want ErrExternalChange", err)
	}
	if readFile(t, path) != edited {
		t.Fatal("the externally edited file must not be overwritten")
	}
	if len(l.Rows()) != 2 {
		t.Fatalf("ledger should have reloaded the file, has %d rows", len(l.Rows()))
	}
}

func TestLedgerKeepsChangesWhenSaveFails(t *testing.T) {
	l, path := openTestLedger(t, csvHeader)
	if err := os.Chmod(path, 0o600); err != nil {
		t.Fatal(err)
	}
	l.path = path + "/blocked/transactions.csv"

	if _, err := l.Add(Fields{Time: "2026-01-02", Amount: "-1"}); err == nil {
		t.Fatal("expected a save error")
	}
	if len(l.Rows()) != 1 || !l.Unsaved() {
		t.Fatalf("rows = %d, unsaved = %v; the change must stay in memory", len(l.Rows()), l.Unsaved())
	}

	l.path = path
	if err := l.Save(); err != nil {
		t.Fatal(err)
	}
	if l.Unsaved() || !strings.Contains(readFile(t, path), "2026-01-02") {
		t.Fatal("retry should write the kept change")
	}
}

func TestLedgerRowsNewestFirst(t *testing.T) {
	l, _ := openTestLedger(t, csvHeader+
		"a,2026-01-01T00:00:00+00:00,-1,,,,\n"+
		"b,2026-01-03T00:00:00+00:00,-1,,,,\n"+
		"c,2026-01-02T23:30:00-05:00,-1,,,,\n")
	var ids []string
	for _, r := range l.Rows() {
		ids = append(ids, r.ID)
	}
	if strings.Join(ids, "") != "cba" {
		t.Fatalf("order = %v", ids)
	}
}
