# "Add to command center" Shortcut

Say "Add to command center", then something like "gym tomorrow 7am for an hour" or "call the
dentist Friday at ten". The server decides whether it's a calendar event or a reminder, the same
way the capture box does, and Siri reads back what it made: "Added Gym to Fitness, Wed 11 Nov
07:00–08:00."

## Make it

In the Shortcuts app, make a new shortcut named **Add to command center** with these actions:

1. **Dictate Text** (Stop listening: After pause).
2. **Text**: a random id, so a retry can't add twice. Use a **Get UUID** action if your Shortcuts has one, or
   **Current Date** formatted as `yyyyMMddHHmmssSSS`.
3. **Get Contents of URL**
   - URL: `https://<your server>/v1/captures`
   - Method: **POST**
   - Headers: `Authorization` = `Bearer <device token>` (make one with
     `bun run settings devices add "Siri"`; over Tailscale you can leave it out)
   - Request Body: **JSON**, with `text` = *Dictated Text* and `requestId` = the id from step 2.
4. **Get Dictionary Value** for key `message` from *Contents of URL*.
5. **Speak Text**: *Dictionary Value*.

## What it sends

```sh
curl -X POST "$SERVER/v1/captures" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text": "gym tomorrow 7am for an hour", "requestId": "20261110080000123"}'
```

With no calendar connected, a line that reads as an event becomes a reminder in the inbox. The
existing "Add a task" Shortcut (`VoiceService/AddTask`) keeps working as before.
