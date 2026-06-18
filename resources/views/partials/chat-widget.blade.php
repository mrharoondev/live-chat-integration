{{-- NilaQ Web-based Live Chat Widget: always load so the launcher appears. Set NILAQ_API_DOMAIN / NILAQ_CHANNEL_ID in .env for your NilaQ backend. --}}
<script src="{{ route('widget-config') }}"></script>
<script async src="{{ route('chat-widget') }}?v={{ time() }}"></script>
