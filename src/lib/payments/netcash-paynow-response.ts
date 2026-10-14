import { SaxesParser } from "saxes";

const SOAP = "http://schemas.xmlsoap.org/soap/envelope/";
const TEMP = "http://tempuri.org/";
const XSI = "http://www.w3.org/2001/XMLSchema-instance";
type Node = { name: string; uri: string; text: string; nil: boolean; children: Node[] };
const uncertain = (): never => { throw Error("PAYNOW_OUTCOME_UNCERTAIN"); };
function one(parent: Node, name: string, uri: string) {
  const matches = parent.children.filter(node => node.name === name && node.uri === uri);
  if (matches.length !== 1) return uncertain();
  return matches[0];
}

/** Current PayNow WSDL returns a nullable XML Schema string inside SOAP 1.1.
 * Validate the complete document before treating that string as an outcome.
 * Escaped invoice XML and CDATA are decoded once by the XML parser.
 */
export function payNowSoapResult(xml: string, method: string): string {
  if (Buffer.byteLength(xml, "utf8") > 64000) return uncertain();
  const document: Node = { name: "document", uri: "", text: "", nil: false, children: [] };
  const stack = [document];
  let count = 0;
  const parser = new SaxesParser({ xmlns: true, forceXMLVersion: true, defaultXMLVersion: "1.0" });
  parser.on("error", uncertain);
  parser.on("doctype", uncertain);
  parser.on("processinginstruction", uncertain);
  parser.on("opentag", tag => {
    if (++count > 300 || stack.length > 16) return uncertain();
    const attributes = Object.values(tag.attributes).filter(attribute => attribute.uri !== "http://www.w3.org/2000/xmlns/");
    if (attributes.some(attribute => attribute.uri !== XSI || attribute.local !== "nil" || !["true", "false", "1", "0"].includes(attribute.value))) return uncertain();
    const node: Node = { name: tag.local, uri: tag.uri, text: "", nil: attributes.some(attribute => ["true", "1"].includes(attribute.value)), children: [] };
    stack.at(-1)!.children.push(node);
    stack.push(node);
  });
  const append = (value: string) => { stack.at(-1)!.text += value; };
  parser.on("text", append);
  parser.on("cdata", append);
  parser.on("closetag", () => { stack.pop(); });
  try { parser.write(xml).close(); } catch { return uncertain(); }
  if (stack.length !== 1 || document.children.length !== 1 || document.text.trim()) return uncertain();
  const envelope = one(document, "Envelope", SOAP);
  if (envelope.nil || envelope.text.trim() || envelope.children.some(node => node.uri !== SOAP || !["Header", "Body"].includes(node.name)) || envelope.children.filter(node => node.name === "Header").length > 1) return uncertain();
  const body = one(envelope, "Body", SOAP);
  if (body.nil || body.text.trim() || body.children.length !== 1) return uncertain();
  const response = one(body, method + "Response", TEMP);
  if (response.nil || response.text.trim() || response.children.length !== 1) return uncertain();
  const result = one(response, method + "Result", TEMP);
  if (result.nil || result.children.length || !result.text.trim()) return uncertain();
  return result.text.trim();
}
