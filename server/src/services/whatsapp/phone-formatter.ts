import schema from '../../../shared/schema.js';

const { phoneNumberSchema } = schema;

/**
 * Format phone number for WhatsApp using Twilio's format
 * @param phone Raw phone number string
 * @returns Formatted WhatsApp phone number (e.g., whatsapp:+919876543210)
 * @throws Error if phone number is invalid
 */
export function formatPhoneForWhatsApp(phone: string): string {
  try {
    // Use the existing phone validation schema to format the number
    const validatedPhone = phoneNumberSchema.parse(phone);
    
    // Add WhatsApp prefix required by Twilio
    return `whatsapp:${validatedPhone}`;
  } catch (error) {
    throw new Error(`Invalid phone number format: ${phone}. Please provide a valid phone number.`);
  }
}

/**
 * Check if a phone number is valid without throwing
 * @param phone Phone number to validate (can be null/undefined)
 * @returns true if valid, false otherwise
 */
export function isValidPhone(phone: string | null | undefined): boolean {
  if (!phone || typeof phone !== 'string' || phone.trim() === '') {
    return false;
  }
  
  try {
    phoneNumberSchema.parse(phone);
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract clean phone number without WhatsApp prefix
 * @param whatsappPhone Phone number with whatsapp: prefix
 * @returns Clean phone number
 */
export function extractPhoneNumber(whatsappPhone: string): string {
  return whatsappPhone.replace(/^whatsapp:/, '');
}