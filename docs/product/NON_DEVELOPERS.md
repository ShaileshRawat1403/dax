# DAX for Non-Developers

DAX is a guided AI workstation.

If normal AI chat tools feel unpredictable, DAX is meant to feel more controlled:

- it shows what the model is trying to do
- it pauses when something needs review
- it keeps a visible record of the work

## The Easiest Way to Think About DAX

DAX is not just "ask AI a question."

It is closer to:

1. You give DAX a goal.
2. DAX proposes a plan.
3. DAX does the safe parts automatically.
4. DAX pauses when something needs approval or attention.
5. You keep control of the final outcome.

## The 3 Google / Gemini Sign-In Options

Most people will only need one of these:

### 1. Gemini API Key

Use this if you have a normal Gemini API key from Google AI Studio.

Choose this when you want:

- the simplest setup
- predictable API-key based access
- a good default for most technical users

### 2. Gemini Subscription Sign-In

Use this if you already use Gemini through a subscription, especially through the `gemini` CLI.

Choose this when you want:

- to use your Gemini Pro or Pro Plus access
- DAX to use your existing Gemini login
- DAX to handle the subscription integration for you

If this lane expires later, DAX should tell you to run `gemini` again.

Important: DAX uses the account that is authenticated on your own machine. It does not ship somebody else's subscription to you. If you install DAX on your laptop, it will use your Gemini login, your API key, or your OAuth setup.

### 3. Custom Google OAuth Client

Use this only if you or your team intentionally manage your own Google OAuth app.

Choose this when you want:

- a custom enterprise setup
- more control over your own OAuth client credentials

If you are unsure, this is usually not the right first choice.

## What a Rate-Limit Message Means

Sometimes Gemini subscription usage gets busy.

If DAX says the Gemini subscription lane is busy:

- DAX is already waiting and retrying for you
- DAX will also pause briefly before the next request so it does not keep hitting the same limit immediately
- this usually means Google is temporarily limiting requests on that subscription lane
- you often just need to wait a little

If it keeps happening:

- wait and try again
- or switch to `Gemini API Key` if you want a different lane

## What an Approval Pause Means

An approval pause is not a failure.

It means DAX reached a point where it wants you to review something before continuing.

This is one of the main reasons DAX exists:

- less silent automation
- more visible control

## A Good First Experience

If you are new, start simple:

1. Install DAX.
2. Open a project folder.
3. Run `dax`.
4. Connect one provider.
5. Ask DAX to explain, review, or analyze something small first.

Good beginner prompts:

- `Explain this repository in simple words`
- `Review this project for obvious risks`
- `Help me understand what this folder does`

## If Something Feels Confusing

Use these checks:

- `dax --version`
- `dax auth doctor`
- `dax auth login`

If the Google subscription lane stops working after it worked earlier, run:

```bash
gemini
```

Then reconnect through DAX.

## One Thing That Surprises New Users

If DAX already looks connected when you open it in a different project, that usually means you already authenticated on this machine earlier.

That is normal.

DAX authentication is usually:

- local to your machine
- shared across projects for your OS user
- based on your own login, keys, or local `gemini` CLI session

## The Main Idea

DAX is designed to make AI work feel more understandable, more reviewable, and less chaotic.

If you are non-technical, the best way to use it is to treat it like a guided operator console, not a magic black box.
