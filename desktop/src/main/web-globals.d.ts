// This project is compiled without the DOM lib, and @types/node does not declare these two web types as globals.
// The main-process code does not need them (it derives what it needs from the runtime's own signatures); the unit tests name them.
type CryptoKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;
type BodyInit = ConstructorParameters<typeof Response>[0];
