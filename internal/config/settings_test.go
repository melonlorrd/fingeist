package config

import (
	"reflect"
	"testing"
	"time"

	"el-costas/internal/domain"
)

func TestSettingsRoundTrip(t *testing.T) {
	project := domain.Project{
		Name: "Home", Currency: "INR", Decimals: 2,
		SmallPurchaseThresholds: []domain.Money{10000, 25000},
		Workdays:                []time.Weekday{time.Monday, time.Friday},
		TargetAllocation:        map[domain.AssetClass]int{domain.ClassEquity: 60, domain.ClassGold: 40},
	}
	settings := SettingsOf(project)
	want := Settings{
		Name: "Home", Currency: "INR", SmallPurchaseThresholds: []string{"100.00", "250.00"},
		Workdays: []string{"mon", "fri"}, TargetAllocation: map[string]int{"equity": 60, "gold": 40},
	}
	if !reflect.DeepEqual(settings, want) {
		t.Fatalf("got %+v, want %+v", settings, want)
	}

	got, err := ApplySettings(project, settings)
	if err != nil || !reflect.DeepEqual(got, project) {
		t.Fatalf("got %+v, %v", got, err)
	}
}

func TestApplySettings(t *testing.T) {
	base := domain.Project{Name: "Home", Currency: "INR", Decimals: 2, Workdays: []time.Weekday{time.Monday}}
	good := Settings{Name: " Renamed ", Currency: "USD", SmallPurchaseThresholds: []string{"500", " 99.5 "}, Workdays: []string{"Sat", "mon"}}

	got, err := ApplySettings(base, good)
	if err != nil {
		t.Fatal(err)
	}
	if got.Name != "Renamed" || got.Currency != "INR" {
		t.Fatalf("name = %q, currency = %q; the currency must stay locked", got.Name, got.Currency)
	}
	if !reflect.DeepEqual(got.SmallPurchaseThresholds, []domain.Money{9950, 50000}) || !reflect.DeepEqual(got.Workdays, []time.Weekday{time.Monday, time.Saturday}) {
		t.Fatalf("thresholds = %v, workdays = %v", got.SmallPurchaseThresholds, got.Workdays)
	}
	if got.TargetAllocation != nil {
		t.Fatalf("no targets given, got %v", got.TargetAllocation)
	}

	bad := map[string]Settings{
		"blank name":       {Name: " ", Workdays: []string{"mon"}},
		"bad threshold":    {Name: "A", Workdays: []string{"mon"}, SmallPurchaseThresholds: []string{"lots"}},
		"zero threshold":   {Name: "A", Workdays: []string{"mon"}, SmallPurchaseThresholds: []string{"0"}},
		"no workdays":      {Name: "A"},
		"unknown day":      {Name: "A", Workdays: []string{"someday"}},
		"targets not 100":  {Name: "A", Workdays: []string{"mon"}, TargetAllocation: map[string]int{"equity": 90}},
		"unknown class":    {Name: "A", Workdays: []string{"mon"}, TargetAllocation: map[string]int{"crypto": 100}},
		"negative percent": {Name: "A", Workdays: []string{"mon"}, TargetAllocation: map[string]int{"equity": 110, "gold": -10}},
	}
	for name, s := range bad {
		t.Run(name, func(t *testing.T) {
			if _, err := ApplySettings(base, s); err == nil {
				t.Fatal("expected an error")
			}
		})
	}
}
