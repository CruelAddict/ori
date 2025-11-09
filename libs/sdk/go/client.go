package orisdk

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
)

// Client represents a JSON-RPC client for the Ori server
type Client struct {
	url        string
	httpClient *http.Client
	nextID     int
}

// NewClient creates a new Ori SDK client
func NewClient(url string) *Client {
	return &Client{
		url:        url,
		httpClient: &http.Client{},
		nextID:     1,
	}
}

// NewClientUnix creates a client that talks HTTP over a Unix domain socket
// socketPath: path to the unix domain socket; requests use URL http://unix/rpc
func NewClientUnix(socketPath string) *Client {
	dial := func(ctx context.Context, network, addr string) (net.Conn, error) {
		return net.Dial("unix", socketPath)
	}
	transport := &http.Transport{
		DialContext:           dial,
		DisableCompression:    true,
		MaxIdleConnsPerHost:   2,
		ResponseHeaderTimeout: 0,
	}
	return &Client{
		url:        "http://unix/rpc",
		httpClient: &http.Client{Transport: transport},
		nextID:     1,
	}
}

// JSONRPCRequest represents a JSON-RPC 2.0 request
type JSONRPCRequest struct {
	JSONRPC string `json:"jsonrpc"`
	Method  string `json:"method"`
	Params  any    `json:"params,omitempty"`
	ID      int    `json:"id"`
}

// JSONRPCResponse represents a JSON-RPC 2.0 response
type JSONRPCResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *RPCError       `json:"error,omitempty"`
	ID      int             `json:"id"`
}

// RPCError represents a JSON-RPC 2.0 error
type RPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}

// call performs a JSON-RPC call
func (c *Client) call(method string, params any, result any) error {
	req := JSONRPCRequest{
		JSONRPC: "2.0",
		Method:  method,
		Params:  params,
		ID:      c.nextID,
	}
	c.nextID++

	reqBody, err := json.Marshal(req)
	if err != nil {
		return fmt.Errorf("failed to marshal request: %w", err)
	}

	httpReq, err := http.NewRequest("POST", c.url, bytes.NewBuffer(reqBody))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	var rpcResp JSONRPCResponse
	if err := json.NewDecoder(resp.Body).Decode(&rpcResp); err != nil {
		return fmt.Errorf("failed to decode response: %w", err)
	}

	if rpcResp.Error != nil {
		return fmt.Errorf("RPC error %d: %s (data: %v)", rpcResp.Error.Code, rpcResp.Error.Message, rpcResp.Error.Data)
	}

	if result != nil {
		if err := json.Unmarshal(rpcResp.Result, result); err != nil {
			return fmt.Errorf("failed to unmarshal result: %w", err)
		}
	}

	return nil
}

// ListConfigurations calls the listConfigurations RPC method
func (c *Client) ListConfigurations() (*ConfigurationsResult, error) {
	var result ConfigurationsResult
	if err := c.call("listConfigurations", struct{}{}, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// Connect calls the connect RPC method with a configuration name
func (c *Client) Connect(configurationName string) (*ConnectResult, error) {
	type params struct {
		ConfigurationName string `json:"configurationName"`
	}
	p := params{ConfigurationName: configurationName}
	var result ConnectResult
	if err := c.call("connect", p, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// GetNodes fetches graph nodes for the given configuration and optional node IDs.
func (c *Client) GetNodes(configurationName string, nodeIDs ...string) (*GetNodesResult, error) {
	params := GetNodesParams{ConfigurationName: configurationName}
	if len(nodeIDs) > 0 {
		params.NodeIDs = append([]string{}, nodeIDs...)
	}
	var result GetNodesResult
	if err := c.call("getNodes", params, &result); err != nil {
		return nil, err
	}
	return &result, nil
}
