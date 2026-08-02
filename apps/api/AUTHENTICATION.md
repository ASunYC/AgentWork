# Task API actor context

Task domain services accept only `ActorContext` and do not inspect HTTP headers.

`x-user-id` and `x-agent-id` are temporary test/development transport adapters in
`CurrentActor`. They are not a production authentication mechanism. Production
deployments must install an authentication guard that validates the session or API
key and assigns the verified actor to `request.actor`; arbitrary identity headers
must be removed or ignored at the trusted ingress.
