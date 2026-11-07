package config

import (
	"fmt"
	"slices"
	"strings"
	"time"

	"el-costas/internal/domain"
)

// Settings is the editable part of a project, as text for the settings page.
type Settings struct {
	Name                    string         `json:"name"`
	Currency                string         `json:"currency"`
	SmallPurchaseThresholds []string       `json:"smallPurchaseThresholds"`
	Workdays                []string       `json:"workdays"`
	TargetAllocation        map[string]int `json:"targetAllocation"`
}

func SettingsOf(p domain.Project) Settings {
	file := fileOf(p)
	s := Settings{
		Name: p.Name, Currency: p.Currency,
		SmallPurchaseThresholds: file.SmallPurchaseThresholds, Workdays: file.Workdays, TargetAllocation: file.TargetAllocation,
	}
	if s.TargetAllocation == nil {
		s.TargetAllocation = map[string]int{}
	}
	if s.SmallPurchaseThresholds == nil {
		s.SmallPurchaseThresholds = []string{}
	}
	if s.Workdays == nil {
		s.Workdays = []string{}
	}
	return s
}

// ApplySettings returns the project with the settings applied. The currency never changes.
func ApplySettings(p domain.Project, s Settings) (domain.Project, error) {
	p.Name = strings.TrimSpace(s.Name)

	p.SmallPurchaseThresholds = nil
	for _, text := range s.SmallPurchaseThresholds {
		amount, err := domain.ParseMoney(strings.TrimSpace(text), p.Decimals)
		if err != nil {
			return domain.Project{}, fmt.Errorf("small-purchase threshold: %w", err)
		}
		p.SmallPurchaseThresholds = append(p.SmallPurchaseThresholds, amount)
	}
	slices.Sort(p.SmallPurchaseThresholds)

	p.Workdays = nil
	for _, name := range s.Workdays {
		day := slices.Index(weekdayNames, strings.ToLower(name))
		if day < 0 {
			return domain.Project{}, fmt.Errorf("unknown day %q", name)
		}
		p.Workdays = append(p.Workdays, time.Weekday(day))
	}
	slices.Sort(p.Workdays)

	p.TargetAllocation = nil
	for class, percent := range s.TargetAllocation {
		if p.TargetAllocation == nil {
			p.TargetAllocation = map[domain.AssetClass]int{}
		}
		p.TargetAllocation[domain.AssetClass(class)] = percent
	}
	if err := validateProject(p); err != nil {
		return domain.Project{}, err
	}
	return p, nil
}
