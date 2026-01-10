async function testFetch() {
  try {
    console.log("Testing fetch...")
    const response = await fetch("http://localhost:8080/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "listConfigurations",
        params: {},
        id: 1,
      }),
    })
    console.log("Response status:", response.status)
    const data = await response.json()
    console.log("Response data:", JSON.stringify(data, null, 2))
  } catch (err) {
    console.error("Error:", err)
  }
}

void testFetch()
