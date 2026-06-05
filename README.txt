VMAS Workplace Web App Update

Included fixes:
1. User remains logged in until manual logout.
2. Session saved in localStorage.
3. Single-device login check retained.
4. Punch In / Punch Out improved for iOS.
5. Incoming call alert includes ringtone, vibration, and browser notification.
6. Logout clears active session and stops ringtone.

Important iPhone limitation:
iOS Safari/PWA cannot guarantee ringing when the app is fully closed or killed.
For true standby/locked-screen ringing, a native iOS app with APNS + CallKit is required.

Setup:
1. Replace firebase-config.js with your Firebase web credentials.
2. Upload all files to GitHub Pages root.
3. Use firebase_demo_data.json if demo data is needed.
4. Use firebase_rules_testing.json during testing.
