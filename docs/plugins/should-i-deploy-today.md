# Should I deploy today?

`@sbordeyne/backstage-plugin-should-i-deploy-today`

A home page widget that answers one question, in one screen: should you deploy right now? Green for
yes, amber for "you probably want to sleep tonight", red for no — with a random quip explaining
itself.

Everything is decided in the browser. There is no backend module, no configuration key and no
network call: the widget reads the clock and the visitor's locale, matches a rule, and picks a
message.

## The rules

The first rule that matches wins, so the order is the whole behaviour:

| Rule                 | When                                      | Status  | Colour |
| -------------------- | ----------------------------------------- | ------- | ------ |
| `friday_the_13th`    | Friday the 13th                           | KO      | red    |
| `weekend`            | Saturday or Sunday                        | KO      | red    |
| `holiday`            | Public holiday in the visitor's country   | KO      | red    |
| `holiday_eve`        | Public holiday tomorrow                   | KO      | red    |
| `friday`             | Any Friday                                | KO      | red    |
| `evening_or_night`   | Before 09:00, or from 18:00               | KO      | red    |
| `thursday_afternoon` | Thursday from 16:00                       | WARNING | amber  |
| `afternoon`          | Any other day from 16:00                  | WARNING | amber  |
| `none`               | Anything left — a regular working morning | OK      | green  |

Two consequences of that ordering are deliberate:

- **Holidays outrank Friday.** Christmas Day 2026 falls on a Friday, and the widget says something
  about Christmas rather than something about Fridays.
- **Friday outranks the afternoon.** A Friday at 16:30 is a Friday problem, not an afternoon
  problem, so it is red rather than amber.

## Where the holidays come from

[`date-holidays`](https://www.npmjs.com/package/date-holidays), restricted to `public` holidays and
initialised with the country from `Intl.DateTimeFormat().resolvedOptions()` — the visitor's own
locale, falling back to `US` when the locale carries no region. The same call provides the timezone.

Four holidays have their own message sets: Christmas Day, New Year's Day, Easter Monday and All
Saints' Day. Every other public holiday, in every country, uses the generic set.

!!! note "Holiday keys are name slugs, not labels"

    The message sets in `src/data/reasons.json` are keyed by the holiday's **English** name,
    lowercased, with non-alphanumeric characters removed and spaces replaced by underscores:
    `Christmas Day` → `christmas_day`, `New Year's Day` → `new_years_day`. A key that matches no
    holiday name is never an error — it just silently never fires, and the generic `default` set is
    used instead. Verify the slug when adding a set.

## Installation

```bash
yarn --cwd packages/app add @sbordeyne/backstage-plugin-should-i-deploy-today
```

The plugin targets the [new frontend system](https://backstage.io/docs/frontend-system/architecture/index)
and exports itself as the package default:

```ts
// packages/app/src/App.tsx
import shouldIDeployTodayPlugin from '@sbordeyne/backstage-plugin-should-i-deploy-today';

export const app = createApp({
  features: [shouldIDeployTodayPlugin],
});
```

It contributes one `HomePageWidgetBlueprint` extension, which puts **Should I deploy today?** in the
home page's widget picker. Nothing has to be composed by hand, and the widget carries its own
minimum size (2 rows, 2 columns).

## Customising the messages

All the copy lives in [`src/data/reasons.json`](https://github.com/sbordeyne/backstage-plugins/blob/master/plugins/should-i-deploy-today/src/data/reasons.json),
one array per rule, plus the `holiday` and `holiday_tomorrow` maps. The widget picks uniformly at
random from the matching array on every render and on every press of **Refresh**, so a rule with a
single message is a rule that always says the same thing.

Changing the copy means forking the package — the messages are bundled, not configuration.

## Theming

The surface uses `@backstage/ui` intent backgrounds (`success`, `warning`, `danger`) and `Text`
variants rather than hand-picked colours or font sizes, so the widget follows whatever theme the app
is running, in both light and dark mode.
