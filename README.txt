TASK MANAGER - INSTALLABLE APP (PWA)

1. Put the whole folder on a website with HTTPS. Free options: Netlify Drop,
   GitHub Pages, Vercel. Upload the folder as-is (keep the icons/ folder).
   The app will NOT install if you just double-click index.html.

2. Open the link on your phone.
   - Android (Chrome): tap the "Install app" button, or the menu (⋮) > "Install app".
   - iPhone (Safari): tap the Share button > "Add to Home Screen".

3. Open it from your home screen. It runs full-screen and loads offline.

Notes
- Alarms ring while the app is open or in the background; they do not fire
  after the phone has fully closed the app.
- After changing any app file, bump CACHE_VERSION in service-worker.js so
  installed copies update.

If the Install button or install option doesn't appear
- The app must be opened from its https:// address. Files opened directly
  from your phone or computer can't be installed or used offline.
- Open the link once while online so the offline files get saved.
- Android: the ⋮ menu in Chrome also has "Install app", even if the button
  doesn't show.
- Already installed? The button hides itself.

Alarm messages
- Settings > Alarm style: ringtone + spoken message, ringtone only, or spoken message only.
- Edit the message in Settings. Use {name}, {task} and {minutes}.
- Task names work best as actions, e.g. "go for a walk", so the message reads
  "Abubakar, it's time to go for a walk."

Alarm voice
- The spoken message repeats every few seconds until you press Dismiss.
- Default message: "{name}, it's time to do the {task}." Name tasks as nouns (walk, homework).

Calendar export
- Settings > Export to calendar downloads task-manager.ics.
- Open it on your phone to add the events. Each alarm shows the sentence and rings even when this app is closed.
- Tasks without a start time are not exported.
- Re-export after changing tasks. Some calendar apps (Google Calendar in particular) may use their own default reminders instead of the ones in the file. Test with one task first.
