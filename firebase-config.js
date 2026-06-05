
window.firebaseConfig = {
  apiKey: "PASTE_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "123456789",
  appId: "APP_ID"
};

firebase.initializeApp(window.firebaseConfig);
const db = firebase.database();
