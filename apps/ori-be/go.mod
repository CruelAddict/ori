module github.com/crueladdict/ori/apps/ori-server

go 1.24.0

replace github.com/crueladdict/ori/libs/sdk/go => ../../libs/sdk/go

require (
	github.com/crueladdict/ori/libs/sdk/go v0.0.0
	gopkg.in/yaml.v3 v3.0.1
)

require (
	golang.org/x/exp/event v0.0.0-20251002181428-27f1f14c8bb9 // indirect
	golang.org/x/exp/jsonrpc2 v0.0.0-20251023183803-a4bb9ffd2546 // indirect
	golang.org/x/xerrors v0.0.0-20240903120638-7835f813f4da // indirect
)
