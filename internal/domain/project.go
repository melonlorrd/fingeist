package domain

// Project holds the settings fixed per project. Decimals is the currency's minor-unit places.
type Project struct {
	Name       string
	Currency   string
	Decimals   int
	Categories []string
}
