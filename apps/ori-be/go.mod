module github.com/crueladdict/ori/apps/ori-server

go 1.24.0

replace github.com/crueladdict/ori/libs/sdk/go => ../../libs/sdk/go

require (
	github.com/crueladdict/ori/libs/sdk/go v0.0.0
	github.com/google/uuid v1.6.0
	golang.org/x/exp/jsonrpc2 v0.0.0-20251023183803-a4bb9ffd2546
	gopkg.in/yaml.v3 v3.0.1
	modernc.org/sqlite v1.31.0
)

require (
	github.com/dustin/go-humanize v1.0.1 // indirect
	github.com/hashicorp/golang-lru/v2 v2.0.7 // indirect
	github.com/mattn/go-isatty v0.0.20 // indirect
	github.com/ncruces/go-strftime v0.1.9 // indirect
	github.com/remyoudompheng/bigfft v0.0.0-20230129092748-24d4a6f8daec // indirect
	golang.org/x/exp/event v0.0.0-20251002181428-27f1f14c8bb9 // indirect
	golang.org/x/sys v0.36.0 // indirect
	golang.org/x/xerrors v0.0.0-20240903120638-7835f813f4da // indirect
	modernc.org/gc/v3 v3.0.0-20240107210532-573471604cb6 // indirect
	modernc.org/libc v1.55.3 // indirect
	modernc.org/mathutil v1.6.0 // indirect
	modernc.org/memory v1.8.0 // indirect
	modernc.org/strutil v1.2.0 // indirect
	modernc.org/token v1.1.0 // indirect
)
