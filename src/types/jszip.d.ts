declare module "jszip" {
  type JSZipInput =
    | string
    | ArrayBuffer
    | Uint8Array
    | Blob
    | Promise<ArrayBuffer>
    | Promise<Uint8Array>
    | Promise<Blob>;

  type JSZipOutputType = "base64" | "binarystring" | "uint8array" | "arraybuffer" | "blob";

  export interface JSZipFileOptions {
    binary?: boolean;
    compression?: string;
    compressionOptions?: Record<string, unknown>;
  }

  export default class JSZip {
    constructor();
    file(name: string, data: JSZipInput, options?: JSZipFileOptions): this;
    folder(name: string): JSZip;
    generateAsync(options: { type: "blob" }): Promise<Blob>;
    generateAsync(options: { type: "arraybuffer" }): Promise<ArrayBuffer>;
    generateAsync(options: { type: "uint8array" }): Promise<Uint8Array>;
    generateAsync(options: { type: "base64" | "binarystring" }): Promise<string>;
    generateAsync(options: { type: JSZipOutputType }): Promise<Blob | ArrayBuffer | Uint8Array | string>;
  }
}
