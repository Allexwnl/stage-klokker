import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCkft4d4c9wd61GL3z1mCZsWR35uWY5zGo",
  authDomain: "stage-klokker.firebaseapp.com",
  projectId: "stage-klokker",
  storageBucket: "stage-klokker.firebasestorage.app",
  messagingSenderId: "2812955368",
  appId: "1:2812955368:web:31b0ef31358f9e3c56975d",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);