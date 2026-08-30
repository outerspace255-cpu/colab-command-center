# Colab Command Center

Colab Command Center gives you a private, Gemini-like control surface for a Google Colab runtime. The web app can ask an AI provider for Python, show the generated code, and—only after confirmation—queue it for the connected Colab notebook.

## Start a Colab connection

1. Open the web app and go to **Setup**.
2. Create a connector session and copy the generated Python cell.
3. Open Google Colab, paste the cell into a new code cell, and run it.
4. Keep that cell running while you use the command center.
5. Return to the command center. The runtime badge should change to **Connected**.

The connector uses an outbound HTTPS request from Colab to the app. It does not expose a Colab port or require an ngrok token.

## Supported AI providers

- OpenAI — `gpt-4o-mini` is a good starting model
- Gemini — `gemini-2.0-flash`
- Anthropic — `claude-3-5-haiku-latest`
- OpenRouter — use the model name from OpenRouter

API keys are sent only for the current request and are not stored by the app. Do not paste keys into notebook cells or chat messages.

## Deploy with Render

1. Push this repository to GitHub.
2. In Render, choose **New → Blueprint** and select the repository.
3. Render will read `render.yaml`, build the workspace, and start the unified web service.
4. Add no AI provider key as a Render environment variable when using Bring Your Own Key mode; enter it in the app for each session.
5. Keep the Render service on a persistent instance if you need a long-running Colab connection. The free instance can sleep, which disconnects the in-memory runtime session.

The first MVP keeps the active connector session in server memory. For multiple users or always-on operation, add a persistent database/Redis session layer and user authentication before exposing it broadly.