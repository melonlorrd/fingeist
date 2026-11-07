package domain

import (
	"slices"
	"time"
)

type Category struct {
	Name     string
	Color    string
	Archived bool
}

// Project holds the settings of one project. Currency and Decimals are fixed at creation.
type Project struct {
	Name                    string
	Currency                string
	Decimals                int
	Categories              []Category
	SmallPurchaseThresholds []Money
	Workdays                []time.Weekday
	TargetAllocation        map[AssetClass]int
}

// KnownCategory reports whether the project lists the category, archived or not.
func (p Project) KnownCategory(name string) bool {
	for _, c := range p.Categories {
		if c.Name == name {
			return true
		}
	}
	return false
}

// CategoryColor returns the category's colour, or "" if the project does not list it.
func (p Project) CategoryColor(name string) string {
	for _, c := range p.Categories {
		if c.Name == name {
			return c.Color
		}
	}
	return ""
}

func (p Project) IsWorkday(day time.Weekday) bool {
	for _, d := range p.Workdays {
		if d == day {
			return true
		}
	}
	return false
}

// WithCategory returns a copy of the project with the category added, or recoloured if it exists.
func (p Project) WithCategory(name, color string) Project {
	p.Categories = slices.Clone(p.Categories)
	for i := range p.Categories {
		if p.Categories[i].Name == name {
			p.Categories[i].Color = color
			return p
		}
	}
	p.Categories = append(p.Categories, Category{Name: name, Color: color})
	return p
}

// WithArchived returns a copy of the project with the category archived or restored, and whether it exists.
func (p Project) WithArchived(name string, archived bool) (Project, bool) {
	p.Categories = slices.Clone(p.Categories)
	for i := range p.Categories {
		if p.Categories[i].Name == name {
			p.Categories[i].Archived = archived
			return p, true
		}
	}
	return p, false
}
