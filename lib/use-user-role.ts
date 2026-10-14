"use client";
const user = { uid: "local-owner" };
export function useUserRole() { return { user, role: "admin" as const, active: true, loading: false, isAdmin: true }; }
