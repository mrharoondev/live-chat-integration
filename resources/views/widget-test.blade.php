<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Live Chat Channel — Widget Test</title>
  <style>
    body {
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      margin: 40px;
      line-height: 1.6;
      max-width: 640px;
    }
    code {
      background: #f1f5f9;
      padding: 2px 6px;
      border-radius: 6px;
      font-size: 0.9em;
    }
    .meta {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 16px 20px;
      margin: 20px 0;
      font-size: 14px;
    }
    .meta dt { font-weight: 600; margin-top: 8px; }
    .meta dt:first-child { margin-top: 0; }
    .meta dd { margin: 4px 0 0; color: #475569; }
  </style>
</head>
<body>
  <h2>Live Chat Channel — widget test</h2>
  <p>
    This page loads the NilaQ live chat widget against your backend using the
    <strong>blog-system</strong> channel configuration.
  </p>

  <dl class="meta">
    <dt>Channel number</dt>
    <dd><code>{{ $channelId }}</code></dd>
    <dt>Backend</dt>
    <dd><code>{{ $apiDomain }}</code></dd>
    <dt>Agent inbox</dt>
    <dd><a href="http://localhost:3000/inbox" target="_blank" rel="noopener">http://localhost:3000/inbox</a></dd>
  </dl>

  <p>
    Open the chat launcher, enter your email in pre-chat, then go offline (close tab or wait).
    When an agent sends a message, you should receive an email alert. Reply to that email — the
    reply should appear as a normal live chat message in the inbox.
  </p>

  <script>
    window.ChatWidgetConfig = {
      apiDomain: @json($apiDomain),
      channelId: @json($channelId),
      skipAllowedDomainsCheck: true,
      onNotify: (msg) => console.log("[Live Chat widget]", msg),
    };
  </script>
  <script async src="{{ route('chat-widget') }}"></script>
</body>
</html>
