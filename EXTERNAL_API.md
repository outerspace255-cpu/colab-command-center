# CC+ External API

The external API lets an approved client ask CC+ to analyze a task without opening the web interface. The key is server-side and must be stored as the Replit Secret `CC_API_KEY`.

## Authentication

Send the key in either header:

```http
X-CC-API-Key: <CC_API_KEY>
```

or:

```http
Authorization: Bearer <CC_API_KEY>
```

Never commit the real key or place it in frontend code.

## Endpoints

### Health

```bash
curl https://YOUR_APP_DOMAIN/api/v1/health \
  -H "X-CC-API-Key: $CC_API_KEY"
```

### Runtime status

```bash
curl https://YOUR_APP_DOMAIN/api/v1/runtime/status \
  -H "X-CC-API-Key: $CC_API_KEY"
```

### Ask CC+

```bash
curl https://YOUR_APP_DOMAIN/api/v1/assistant/chat \
  -H "Content-Type: application/json" \
  -H "X-CC-API-Key: $CC_API_KEY" \
  -d '{"message":"Explain the loaded dataframe step by step.","execute":false,"preference":"ensemble"}'
```

The response includes `reply`, optional `code`, `provider`, `model`, and `commandId`. Keep `execute` set to `false` unless you intentionally want generated code queued for a connected runtime and supply its `sessionId`.