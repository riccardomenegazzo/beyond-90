# Ask an assistant about your customers (MCP)

`beyond90 mcp ROOT` starts a local [Model Context Protocol](https://modelcontextprotocol.io) server over standard input and output. An AI assistant on your machine can then answer questions such as *which customers have the lowest coverage this quarter?* or *what would it take to bring Northwind to 90%?* from your real data.

```
beyond90 mcp ~/customers
```

`ROOT` is a directory whose sub-folders are customer data directories (the same layout as `beyond90 portfolio`). In an assistant that reads an MCP configuration file:

```json
{ "mcpServers": { "beyond90": { "command": "beyond90", "args": ["mcp", "/home/me/customers"] } } }
```

## Tools

| Tool | Answers |
|---|---|
| `list_customers` | every customer with its Yield and weakest stage, lowest first |
| `score` | Yield and the four stages with the main leaks |
| `actions` | the open actions, ranked by estimated effect, with effort, owner and what done looks like |
| `what_if` | scenarios compared: today, right after, once settled (see [what-if](whatif.md)) |
| `path_to_target` | the steps that reach a target Yield, biggest gain first |

## What it promises

- **Read only.** No tool writes, sends or deletes. Each is declared read-only to the assistant, and a test checks that using every tool changes no file.
- **No network.** The server opens no listener and makes no request. It talks to the program that started it, nothing else.
- **Confined.** It can see the customer folders directly under `ROOT`, nothing else. A name with a path, a leading dot or a symbolic link that leaves `ROOT` is refused.
- **Bounded.** Messages over 1 MiB are refused, lists are capped, and a bug in one tool is reported to the assistant instead of ending the session.

## What it cannot promise

- **The model sees what the tools return.** Customer data goes to whichever assistant you connect. Connect one you are allowed to show it to, as you would for any other tool that reads these files.
- **Text in customer files reaches the model as data.** An account name or finding title could carry instructions meant for a model. Because the tools cannot change anything, a trick like that cannot do damage through this server, but the answer you get may still be wrong: read it before acting on it.
- **It has not been run against every assistant.** It follows the protocol (versions 2025-06-18, 2025-03-26 and 2024-11-05) and is tested against that, not against each client.
