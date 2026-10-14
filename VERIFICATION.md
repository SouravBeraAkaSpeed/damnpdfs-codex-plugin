# Release verification — 14 October 2026

Version **1.0.0**, public marketplace **damnpdfs**, plugin **damnpdfs@damnpdfs**.

- **14 automated tests pass**, including the stdio protocol, in-memory credential redaction, disconnected refusals, schema drift, exact multipart bytes, authenticated exports, no overwrites, external URL/traversal refusal, response-size bounds and concurrent-operation controls.
- Codex manifest/marketplace, four square light/dark PNG icons, skill metadata, path containment and secret/private-path checks pass. The release ZIP contains the root `.codex-plugin/plugin.json`, `.mcp.json` and all referenced files. Independent ZIP parsing confirms 18 entries.
- Actual installation uses `codex plugin marketplace add` from the public Git repository, then `codex plugin add damnpdfs@damnpdfs`. Codex reports installed/enabled. The materialized installed package starts successfully through the standard MCP SDK and exposes **84 commands: 71 task tools, eight workspace operations and five helpers**.
- Public catalog comparison matches all packaged operation names and schemas. This checks compatibility, not automatic execution coverage of every supported tool.

## Real browser-paired checks

The complete run finishes successfully on the actual hosted DamnPDFs application:

1. Redeem a fresh single-use code; no session credential appears in tool output.
2. Match the live catalog and receive a response from an empty browser workspace.
3. Create a fictional PDF through browser processing, save it and independently extract its expected text.
4. Feed its artifact into cloud rotation, save the output, independently verify the quarter-turn rotation and retained text, and verify the source bytes are unchanged.
5. Import an exact local fictional PNG through the installed bridge, run native cloud image compression and save a valid transparent **80 × 60 WebP**.
6. Refuse overwriting the saved result.
7. Acknowledge workspace clearing, independently observe no remaining test inputs/results, revoke the session and observe disconnected status.

An earlier verifier expected the PDFium rotation enum to be degrees. That assertion was incorrect: enum `1` is a quarter turn. Its session also clears/revokes successfully; the corrected complete run passes. A Windows module-import path error was corrected in the private verification harness before pairing. Neither required a plugin runtime change.

The bridge requires a connected browser. This release does not certify unattended operation, every arbitrary document, all physical devices or default Public-directory approval. GitHub Actions runs the cold package tests and validation on Linux/Node 22. A new Codex conversation loads newly installed skills/tools.
