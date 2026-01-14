const { initializeApp } = require("firebase/app");

// 1. Импортируем Аутентификацию
const { 
    getAuth, 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    signOut, 
    updateProfile,
    setPersistence,
    browserLocalPersistence,
    onAuthStateChanged
} = require("firebase/auth");

// 2. Импортируем Базу Данных (Firestore)
const { 
    getFirestore, 
    doc, 
    setDoc, 
    getDoc, 
    updateDoc, 
    arrayUnion, 
    arrayRemove, 
    collection, 
    query, 
    orderBy, 
    limit, 
    getDocs, 
    where,
    addDoc,
    deleteDoc
} = require("firebase/firestore");

const firebaseConfig = {
  apiKey: "AIzaSyD00X4Ef3In51OIJrWDDUJEfpT9UfcI474",
  authDomain: "gamelauncher-5e480.firebaseapp.com",
  projectId: "gamelauncher-5e480",
  storageBucket: "gamelauncher-5e480.firebasestorage.app",
  messagingSenderId: "1099232878340",
  appId: "1:1099232878340:web:eca37abd1b1b2c3735ba51",
  measurementId: "G-B2KX473JEY"                         
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app); // Подключаем БД

// Настройка сессии
setPersistence(auth, browserLocalPersistence).catch(console.error);

module.exports = { 
    auth, 
    db, // Экспортируем БД
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    signOut,
    updateProfile,
    onAuthStateChanged,
    doc, setDoc, getDoc, updateDoc, arrayUnion, arrayRemove, collection, query, orderBy, limit, getDocs, where,
    addDoc,       // <--- ДОБАВЬ
    deleteDoc,
};