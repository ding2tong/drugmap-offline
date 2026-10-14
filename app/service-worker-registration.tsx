"use client";
import { useEffect } from "react";
export default function ServiceWorkerRegistration() { useEffect(() => { if ("serviceWorker" in navigator) navigator.serviceWorker.getRegistrations().then(items => items.forEach(item => item.unregister())); }, []); return null; }
