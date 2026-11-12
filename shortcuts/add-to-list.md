# "Add to list" Shortcut

Say "Add to list", then the list and what to add: "shopping", then "oat milk and eggs". Siri
says what it added: "Added oat milk and eggs to Shopping." Something already on the list is
left alone ("Bread was already on it"), and something you've ticked off before goes back to its
section. Lists are notes in the vault's `Lists/` folder ([lists.md](../docs/lists.md)).

## Make it

In the Shortcuts app, make a new shortcut named **Add to list** with these actions:

1. **Ask for Text**: prompt "Which list?" (or a **Text** action with "Shopping" to skip the
   question, and name the shortcut "Add to shopping").
2. **Dictate Text** (Stop listening: After pause).
3. **Get Contents of URL**
   - URL: `https://<your server>/dashboardify.v1.VoiceService/AddToList`
   - Method: **POST**
   - Headers: `Authorization` = `Bearer <device token>` (make one with
     `bun run settings devices add "Siri"`; over Tailscale you can leave it out)
   - Request Body: **JSON**, with `list` = *Provided Input* and `text` = *Dictated Text*.
4. **Get Dictionary Value** for key `message` from *Contents of URL*.
5. **Speak Text**: *Dictionary Value*.

A list that doesn't exist comes back as "There's no list called films. Your lists are …", which
Siri reads out the same way.

## What it sends

```sh
curl -X POST "$SERVER/dashboardify.v1.VoiceService/AddToList" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"list": "shopping", "text": "oat milk and eggs"}'
```
