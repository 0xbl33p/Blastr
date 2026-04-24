import QRCode from 'qrcode';

export async function generateQrBuffer(data: string): Promise<Buffer> {
  return QRCode.toBuffer(data, {
    type: 'png',
    width: 300,
    margin: 2,
    color: { dark: '#000000', light: '#ffffff' },
  });
}
