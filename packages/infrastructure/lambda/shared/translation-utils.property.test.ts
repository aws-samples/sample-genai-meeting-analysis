/**
 * Property-based tests for translation utilities
 * 
 * Tests the core translation utility functions for correctness properties.
 */

import * as fc from 'fast-check';
import {
  filterTranslatablePlaceholders,
  getTranslatedPlaceholderName,
  buildDataObject,
  buildTranslationPrompt,
  parseTranslationResponse,
} from './translation-utils';
import { PlaceholderConfig } from '@meeting-platform/shared';

/**
 * Arbitrary for generating valid placeholder names
 * Placeholder names must start with a letter or underscore, followed by alphanumeric or underscore
 */
const placeholderNameArb = fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{0,29}$/);

/**
 * Arbitrary for generating placeholder values (non-empty strings)
 */
const placeholderValueArb = fc.string({ minLength: 1, maxLength: 200 });

/**
 * Arbitrary for generating PlaceholderConfig objects
 */
const placeholderConfigArb = fc.record({
  name: placeholderNameArb,
  translateEnabled: fc.boolean(),
});

/**
 * Arbitrary for generating arrays of unique PlaceholderConfig objects
 */
const placeholderArrayArb = fc.uniqueArray(placeholderConfigArb, {
  minLength: 0,
  maxLength: 15,
  selector: (p) => p.name,
});

/**
 * Arbitrary for generating extracted data objects with matching placeholder names
 */
function extractedDataArb(placeholders: PlaceholderConfig[]): fc.Arbitrary<Record<string, string>> {
  if (placeholders.length === 0) {
    return fc.constant({});
  }
  
  const entries = placeholders.map(p => 
    fc.tuple(fc.constant(p.name), placeholderValueArb)
  );
  
  return fc.tuple(...entries).map(tuples => 
    Object.fromEntries(tuples)
  );
}

describe('translation-utils property tests', () => {
  /**
   * **Feature: word-template-translation, Property 5: Selective Translation**
   * 
   * For any set of placeholders with mixed translateEnabled states, the generated 
   * data object SHALL contain `{{name_translated}}` entries only for placeholders 
   * where translateEnabled is true.
   * 
   * **Validates: Requirements 3.5, 4.5**
   */
  describe('Property 5: Selective Translation', () => {
    it('filterTranslatablePlaceholders returns only placeholders with translateEnabled=true', () => {
      fc.assert(
        fc.property(
          placeholderArrayArb.chain(placeholders => 
            fc.tuple(fc.constant(placeholders), extractedDataArb(placeholders))
          ),
          ([placeholders, extractedData]) => {
            const result = filterTranslatablePlaceholders(placeholders, extractedData);
            
            // All keys in result should have translateEnabled=true in config
            for (const key of Object.keys(result)) {
              const config = placeholders.find(p => p.name === key);
              if (!config || !config.translateEnabled) {
                return false;
              }
            }
            
            // All placeholders with translateEnabled=true should be in result (if they exist in extractedData)
            for (const placeholder of placeholders) {
              if (placeholder.translateEnabled && extractedData[placeholder.name] !== undefined) {
                if (!(placeholder.name in result)) {
                  return false;
                }
              }
            }
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('filterTranslatablePlaceholders excludes placeholders with translateEnabled=false', () => {
      fc.assert(
        fc.property(
          placeholderArrayArb.chain(placeholders => 
            fc.tuple(fc.constant(placeholders), extractedDataArb(placeholders))
          ),
          ([placeholders, extractedData]) => {
            const result = filterTranslatablePlaceholders(placeholders, extractedData);
            
            // No placeholder with translateEnabled=false should be in result
            for (const placeholder of placeholders) {
              if (!placeholder.translateEnabled && placeholder.name in result) {
                return false;
              }
            }
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('filterTranslatablePlaceholders preserves original values', () => {
      fc.assert(
        fc.property(
          placeholderArrayArb.chain(placeholders => 
            fc.tuple(fc.constant(placeholders), extractedDataArb(placeholders))
          ),
          ([placeholders, extractedData]) => {
            const result = filterTranslatablePlaceholders(placeholders, extractedData);
            
            // All values in result should match the original extractedData values
            for (const [key, value] of Object.entries(result)) {
              if (extractedData[key] !== value) {
                return false;
              }
            }
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('buildDataObject includes translated entries only for provided translations', () => {
      fc.assert(
        fc.property(
          placeholderArrayArb.chain(placeholders => {
            const enabledPlaceholders = placeholders.filter(p => p.translateEnabled);
            return fc.tuple(
              fc.constant(placeholders),
              extractedDataArb(placeholders),
              extractedDataArb(enabledPlaceholders)
            );
          }),
          ([placeholders, originalData, translatedData]) => {
            const result = buildDataObject(originalData, translatedData);
            
            // Check that translated entries exist only for keys in translatedData
            for (const key of Object.keys(translatedData)) {
              const translatedKey = getTranslatedPlaceholderName(key);
              if (!(translatedKey in result)) {
                return false;
              }
            }
            
            // Check that no extra translated entries exist
            const translatedKeys = Object.keys(result).filter(k => k.endsWith('_translated'));
            for (const translatedKey of translatedKeys) {
              const originalKey = translatedKey.replace('_translated', '');
              if (!(originalKey in translatedData)) {
                return false;
              }
            }
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Feature: word-template-translation, Property 6: Translated Placeholder Naming Convention**
   * 
   * For any placeholder name that is translated, the translated placeholder key 
   * SHALL equal the original name concatenated with "_translated".
   * 
   * **Validates: Requirements 4.2**
   */
  describe('Property 6: Translated Placeholder Naming Convention', () => {
    it('getTranslatedPlaceholderName appends _translated suffix', () => {
      fc.assert(
        fc.property(placeholderNameArb, (name) => {
          const translatedName = getTranslatedPlaceholderName(name);
          return translatedName === `${name}_translated`;
        }),
        { numRuns: 100 }
      );
    });

    it('translated placeholder names are unique from original names', () => {
      fc.assert(
        fc.property(placeholderNameArb, (name) => {
          const translatedName = getTranslatedPlaceholderName(name);
          return translatedName !== name;
        }),
        { numRuns: 100 }
      );
    });

    it('buildDataObject uses correct naming convention for translated entries', () => {
      fc.assert(
        fc.property(
          fc.dictionary(placeholderNameArb, placeholderValueArb, { minKeys: 1, maxKeys: 10 }),
          fc.dictionary(placeholderNameArb, placeholderValueArb, { minKeys: 0, maxKeys: 5 }),
          (originalData, translatedData) => {
            const result = buildDataObject(originalData, translatedData);
            
            // For each translated entry, verify the naming convention
            for (const originalKey of Object.keys(translatedData)) {
              const expectedTranslatedKey = `${originalKey}_translated`;
              if (!(expectedTranslatedKey in result)) {
                return false;
              }
              if (result[expectedTranslatedKey] !== translatedData[originalKey]) {
                return false;
              }
            }
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('original data is preserved in buildDataObject', () => {
      fc.assert(
        fc.property(
          fc.dictionary(placeholderNameArb, placeholderValueArb, { minKeys: 1, maxKeys: 10 }),
          fc.dictionary(placeholderNameArb, placeholderValueArb, { minKeys: 0, maxKeys: 5 }),
          (originalData, translatedData) => {
            const result = buildDataObject(originalData, translatedData);
            
            // All original data should be preserved
            for (const [key, value] of Object.entries(originalData)) {
              if (result[key] !== value) {
                return false;
              }
            }
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('buildTranslationPrompt', () => {
    it('includes all placeholder keys in the prompt', () => {
      fc.assert(
        fc.property(
          fc.dictionary(placeholderNameArb, placeholderValueArb, { minKeys: 1, maxKeys: 10 }),
          fc.constantFrom('en', 'es', 'fr', 'de'),
          fc.constantFrom('en', 'es', 'fr', 'de'),
          (placeholders, sourceLang, targetLang) => {
            const prompt = buildTranslationPrompt(placeholders, sourceLang, targetLang);
            
            // All placeholder keys should appear in the prompt
            for (const key of Object.keys(placeholders)) {
              if (!prompt.includes(`"${key}"`)) {
                return false;
              }
            }
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('produces non-empty prompt for non-empty placeholders', () => {
      fc.assert(
        fc.property(
          fc.dictionary(placeholderNameArb, placeholderValueArb, { minKeys: 1, maxKeys: 10 }),
          fc.constantFrom('en', 'es', 'fr', 'de'),
          fc.constantFrom('en', 'es', 'fr', 'de'),
          (placeholders, sourceLang, targetLang) => {
            const prompt = buildTranslationPrompt(placeholders, sourceLang, targetLang);
            return prompt.length > 0;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('parseTranslationResponse', () => {
    it('correctly parses valid JSON responses', () => {
      fc.assert(
        fc.property(
          fc.dictionary(placeholderNameArb, placeholderValueArb, { minKeys: 1, maxKeys: 10 }),
          (data) => {
            const jsonResponse = JSON.stringify(data);
            const parsed = parseTranslationResponse(jsonResponse);
            
            // All keys and values should match
            for (const [key, value] of Object.entries(data)) {
              if (parsed[key] !== value) {
                return false;
              }
            }
            
            return Object.keys(parsed).length === Object.keys(data).length;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('correctly parses JSON wrapped in markdown code blocks', () => {
      fc.assert(
        fc.property(
          fc.dictionary(placeholderNameArb, placeholderValueArb, { minKeys: 1, maxKeys: 10 }),
          (data) => {
            const jsonResponse = '```json\n' + JSON.stringify(data) + '\n```';
            const parsed = parseTranslationResponse(jsonResponse);
            
            for (const [key, value] of Object.entries(data)) {
              if (parsed[key] !== value) {
                return false;
              }
            }
            
            return Object.keys(parsed).length === Object.keys(data).length;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
