declare module "jszip" {
  export default class JSZip {
    constructor();
    file(name: string, data: ArrayBuffer | string): this;
    generateAsync(options: { type: "blob" }): Promise<Blob>;
  }
}
