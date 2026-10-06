package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"strings"

	"dashboardify/internal/apikey"
)

func runAPIKeyCommand(ctx context.Context, databasePath string, args []string, output io.Writer) error {
	if len(args) == 0 {
		return errors.New("usage: dashboardify api-key <create|list|revoke>")
	}
	store, err := apikey.OpenStore(databasePath)
	if err != nil {
		return err
	}
	defer store.Close()

	switch args[0] {
	case "create":
		flags := flag.NewFlagSet("api-key create", flag.ContinueOnError)
		flags.SetOutput(io.Discard)
		name := flags.String("name", "", "human-readable key name")
		scope := flags.String("scope", apikey.ScopeCapturesWrite, "comma-separated scopes")
		if err := flags.Parse(args[1:]); err != nil || flags.NArg() != 0 {
			return errors.New("usage: dashboardify api-key create --name NAME [--scope captures:write]")
		}
		key, token, err := store.Create(ctx, *name, strings.Split(*scope, ","))
		if err != nil {
			return err
		}
		_, err = fmt.Fprintf(output, "id: %s\nname: %s\nscopes: %s\ntoken: %s\n\nStore this token now; it cannot be shown again.\n",
			key.ID, key.Name, strings.Join(key.Scopes, ","), token)
		return err
	case "list":
		if len(args) != 1 {
			return errors.New("usage: dashboardify api-key list")
		}
		keys, err := store.List(ctx)
		if err != nil {
			return err
		}
		for _, key := range keys {
			status := "active"
			if key.RevokedAt != nil {
				status = "revoked"
			}
			lastUsed := "never"
			if key.LastUsedAt != nil {
				lastUsed = key.LastUsedAt.Format("2006-01-02T15:04:05Z07:00")
			}
			if _, err := fmt.Fprintf(output, "%s\t%s\t%s\t%s\t%s\n",
				key.ID, status, strings.Join(key.Scopes, ","), lastUsed, key.Name); err != nil {
				return err
			}
		}
		return nil
	case "revoke":
		flags := flag.NewFlagSet("api-key revoke", flag.ContinueOnError)
		flags.SetOutput(io.Discard)
		id := flags.String("id", "", "API key ID")
		if err := flags.Parse(args[1:]); err != nil || flags.NArg() != 0 || *id == "" {
			return errors.New("usage: dashboardify api-key revoke --id UUID")
		}
		if err := store.Revoke(ctx, *id); err != nil {
			return err
		}
		_, err := fmt.Fprintf(output, "revoked: %s\n", *id)
		return err
	default:
		return fmt.Errorf("unknown api-key command %q", args[0])
	}
}
