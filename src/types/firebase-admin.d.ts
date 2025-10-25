declare module "firebase-admin" {
  const admin: any;
  export = admin;
}

declare module "firebase-admin/firestore" {
  export const FieldValue: any;
  export const Timestamp: any;
}

declare module "firebase-admin/storage" {
  export const getStorage: any;
}
