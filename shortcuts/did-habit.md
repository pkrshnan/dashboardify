# "Did a habit" Shortcut

Say "Did a habit", then what you did: "I meditated", "flossed", "read last night". Siri ticks
the habit and says how it's going: "Ticked Meditate. 12 days." A weekly habit gives the week
instead ("Ticked Lift. 2 of 3 this week."), and "yesterday" or "last night" ticks the day
before. Habits are lines in the vault's `Habits.md` ([habits.md](../docs/habits.md)).

## Make it

In the Shortcuts app, make a new shortcut named **Did a habit** with these actions:

1. **Dictate Text** (Stop listening: After pause).
2. **Get Contents of URL**
   - URL: `https://<your server>/dashboardify.v1.VoiceService/TickHabit`
   - Method: **POST**
   - Headers: `Authorization` = `Bearer <device token>` (make one with
     `bun run settings devices add "Siri"`; over Tailscale you can leave it out)
   - Request Body: **JSON**, with `text` = *Dictated Text*.
3. **Get Dictionary Value** for key `message` from *Contents of URL*.
4. **Speak Text**: *Dictionary Value*.

A habit that doesn't exist comes back as "There's no habit called juggling. Your habits are …",
which Siri reads out the same way.

## What it sends

```sh
curl -X POST "$SERVER/dashboardify.v1.VoiceService/TickHabit" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"text": "I meditated"}'
```
