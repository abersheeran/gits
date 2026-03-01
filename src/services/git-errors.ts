export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtocolError";
  }
}

export class UnsupportedFeatureError extends ProtocolError {
  constructor(feature: string) {
    super(`${feature} unsupported`);
    this.name = "UnsupportedFeatureError";
  }
}

export class NegotiationError extends ProtocolError {
  constructor(message: string) {
    super(message);
    this.name = "NegotiationError";
  }
}
