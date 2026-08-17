# should-i-deploy-today

A home page widget that answers one question: should you deploy right now?

The answer comes from the browser's own locale — no backend, no configuration, no API call. The
widget reads the weekday, the time of day and the public holidays of the visitor's country, picks
the first rule that matches, and renders a random message from that rule's set on a green, amber or
red surface.

Full documentation lives at
[sbordeyne.github.io/backstage-plugins/plugins/should-i-deploy-today](https://sbordeyne.github.io/backstage-plugins/plugins/should-i-deploy-today/).

## Installation

```bash
yarn --cwd packages/app add @sbordeyne/backstage-plugin-should-i-deploy-today
```

The plugin is built for the [new frontend system](https://backstage.io/docs/frontend-system/architecture/index)
and exports itself as the package default, so installing it is adding it to the app's features:

```ts
// packages/app/src/App.tsx
import shouldIDeployTodayPlugin from '@sbordeyne/backstage-plugin-should-i-deploy-today';

export const app = createApp({
  features: [shouldIDeployTodayPlugin],
});
```

It contributes a single `HomePageWidgetBlueprint` extension, so the widget then shows up in the home
page widget picker as **Should I deploy today?** — nothing else has to be mounted by hand.

## The rules

The first match wins, top to bottom:

| Rule                 | When                                      | Status  |
| -------------------- | ----------------------------------------- | ------- |
| `friday_the_13th`    | Friday the 13th                           | KO      |
| `weekend`            | Saturday or Sunday                        | KO      |
| `holiday`            | Public holiday in the visitor's country   | KO      |
| `holiday_eve`        | Public holiday tomorrow                   | KO      |
| `friday`             | Any Friday                                | KO      |
| `evening_or_night`   | Before 09:00 or from 18:00                | KO      |
| `thursday_afternoon` | Thursday from 16:00                       | WARNING |
| `afternoon`          | Any other day from 16:00                  | WARNING |
| `none`               | Anything left — a regular working morning | OK      |

Holidays come from [`date-holidays`](https://www.npmjs.com/package/date-holidays), restricted to
`public` ones, for the country in `Intl.DateTimeFormat().resolvedOptions().locale` (falling back to
`US`). Christmas, New Year's Day, Easter Monday and All Saints' Day have their own message sets;
every other holiday uses the generic ones.

## Development

```bash
yarn start   # serves the widget in isolation, see ./dev
yarn test
```

Messages live in [`src/data/reasons.json`](./src/data/reasons.json), keyed by rule. Holiday-specific
keys are the holiday's English name, lowercased with non-alphanumerics stripped and spaces turned
into underscores — `Christmas Day` becomes `christmas_day`. A key that matches no holiday silently
falls back to `default`, so check the slug when adding one.
