import { parseTranscribeOutput, extractWordLevelData } from './index';
import { TranscriptSegmentItem } from '@meeting-platform/shared';

describe('ProcessTranscribeOutput', () => {
  describe('extractWordLevelData', () => {
    it('should extract words from pronunciation items', () => {
      const items = [
        {
          type: 'pronunciation' as const,
          start_time: '0.5',
          end_time: '0.8',
          alternatives: [{ content: 'Hello', confidence: '0.99' }],
        },
        {
          type: 'pronunciation' as const,
          start_time: '0.9',
          end_time: '1.2',
          alternatives: [{ content: 'world', confidence: '0.98' }],
        },
      ];

      const words = extractWordLevelData(items);

      expect(words).toHaveLength(2);
      expect(words[0]).toEqual({
        startTime: 500,
        endTime: 800,
        text: 'Hello',
        confidence: 0.99,
      });
      expect(words[1]).toEqual({
        startTime: 900,
        endTime: 1200,
        text: 'world',
        confidence: 0.98,
      });
    });

    it('should attach punctuation to preceding words', () => {
      const items = [
        {
          type: 'pronunciation' as const,
          start_time: '0.5',
          end_time: '0.8',
          alternatives: [{ content: 'Hello', confidence: '0.99' }],
        },
        {
          type: 'punctuation' as const,
          alternatives: [{ content: ',' }],
        },
        {
          type: 'pronunciation' as const,
          start_time: '0.9',
          end_time: '1.2',
          alternatives: [{ content: 'world', confidence: '0.98' }],
        },
        {
          type: 'punctuation' as const,
          alternatives: [{ content: '!' }],
        },
      ];

      const words = extractWordLevelData(items);

      expect(words).toHaveLength(2);
      expect(words[0].text).toBe('Hello,');
      expect(words[1].text).toBe('world!');
    });

    it('should handle items without timestamps', () => {
      const items = [
        {
          type: 'pronunciation' as const,
          alternatives: [{ content: 'Hello' }],
        },
        {
          type: 'pronunciation' as const,
          start_time: '0.5',
          end_time: '0.8',
          alternatives: [{ content: 'world', confidence: '0.98' }],
        },
      ];

      const words = extractWordLevelData(items);

      expect(words).toHaveLength(1);
      expect(words[0].text).toBe('world');
    });

    it('should handle items with missing confidence scores', () => {
      const items = [
        {
          type: 'pronunciation' as const,
          start_time: '0.5',
          end_time: '0.8',
          alternatives: [{ content: 'Hello' }], // No confidence
        },
        {
          type: 'pronunciation' as const,
          start_time: '0.9',
          end_time: '1.2',
          alternatives: [{ content: 'world', confidence: '0.98' }],
        },
      ];

      const words = extractWordLevelData(items);

      expect(words).toHaveLength(2);
      expect(words[0].confidence).toBe(1.0); // Default confidence
      expect(words[1].confidence).toBe(0.98);
    });

    it('should convert timestamps from seconds to milliseconds correctly', () => {
      const items = [
        {
          type: 'pronunciation' as const,
          start_time: '123.456',
          end_time: '123.789',
          alternatives: [{ content: 'Test', confidence: '0.95' }],
        },
      ];

      const words = extractWordLevelData(items);

      expect(words).toHaveLength(1);
      expect(words[0].startTime).toBe(123456); // Rounded milliseconds
      expect(words[0].endTime).toBe(123789);
    });

    it('should handle empty items array', () => {
      const items: any[] = [];

      const words = extractWordLevelData(items);

      expect(words).toHaveLength(0);
    });

    it('should handle items with empty alternatives', () => {
      const items = [
        {
          type: 'pronunciation' as const,
          start_time: '0.5',
          end_time: '0.8',
          alternatives: [],
        },
      ];

      const words = extractWordLevelData(items);

      expect(words).toHaveLength(1);
      expect(words[0].text).toBe('');
      expect(words[0].confidence).toBe(1.0);
    });

    it('should handle mixed pronunciation and punctuation items in sequence', () => {
      const items = [
        {
          type: 'pronunciation' as const,
          start_time: '0.0',
          end_time: '0.5',
          alternatives: [{ content: 'Hello', confidence: '0.99' }],
        },
        {
          type: 'punctuation' as const,
          alternatives: [{ content: ',' }],
        },
        {
          type: 'pronunciation' as const,
          start_time: '0.6',
          end_time: '1.0',
          alternatives: [{ content: 'how', confidence: '0.98' }],
        },
        {
          type: 'pronunciation' as const,
          start_time: '1.1',
          end_time: '1.4',
          alternatives: [{ content: 'are', confidence: '0.97' }],
        },
        {
          type: 'pronunciation' as const,
          start_time: '1.5',
          end_time: '1.8',
          alternatives: [{ content: 'you', confidence: '0.96' }],
        },
        {
          type: 'punctuation' as const,
          alternatives: [{ content: '?' }],
        },
      ];

      const words = extractWordLevelData(items);

      expect(words).toHaveLength(4);
      expect(words.map(w => w.text)).toEqual(['Hello,', 'how', 'are', 'you?']);
      expect(words.every(w => w.startTime < w.endTime)).toBe(true);
    });

    it('should handle pronunciation items with only start_time missing', () => {
      const items = [
        {
          type: 'pronunciation' as const,
          end_time: '0.8',
          alternatives: [{ content: 'Hello', confidence: '0.99' }],
        },
      ];

      const words = extractWordLevelData(items);

      expect(words).toHaveLength(0);
    });

    it('should handle pronunciation items with only end_time missing', () => {
      const items = [
        {
          type: 'pronunciation' as const,
          start_time: '0.5',
          alternatives: [{ content: 'Hello', confidence: '0.99' }],
        },
      ];

      const words = extractWordLevelData(items);

      expect(words).toHaveLength(0);
    });

    it('should round fractional milliseconds correctly', () => {
      const items = [
        {
          type: 'pronunciation' as const,
          start_time: '0.1234',
          end_time: '0.5678',
          alternatives: [{ content: 'Test', confidence: '0.99' }],
        },
      ];

      const words = extractWordLevelData(items);

      expect(words).toHaveLength(1);
      expect(words[0].startTime).toBe(123); // 0.1234 * 1000 = 123.4, rounded to 123
      expect(words[0].endTime).toBe(568); // 0.5678 * 1000 = 567.8, rounded to 568
    });
  });

  describe('parseTranscribeOutput', () => {
    it('should parse basic Transcribe output with segments', () => {
      const transcribeResult = {
        results: {
          transcripts: [
            {
              transcript: 'Hello world. How are you?',
            },
          ],
          items: [
            {
              start_time: '0.5',
              end_time: '1.0',
              type: 'pronunciation' as const,
              alternatives: [
                {
                  content: 'Hello',
                  confidence: '0.99',
                },
              ],
            },
            {
              start_time: '1.1',
              end_time: '1.5',
              type: 'pronunciation' as const,
              alternatives: [
                {
                  content: 'world',
                  confidence: '0.98',
                },
              ],
            },
            {
              type: 'punctuation' as const,
              alternatives: [
                {
                  content: '.',
                },
              ],
            },
            {
              start_time: '2.5',
              end_time: '2.8',
              type: 'pronunciation' as const,
              alternatives: [
                {
                  content: 'How',
                  confidence: '0.97',
                },
              ],
            },
            {
              start_time: '2.9',
              end_time: '3.2',
              type: 'pronunciation' as const,
              alternatives: [
                {
                  content: 'are',
                  confidence: '0.96',
                },
              ],
            },
            {
              start_time: '3.3',
              end_time: '3.8',
              type: 'pronunciation' as const,
              alternatives: [
                {
                  content: 'you',
                  confidence: '0.95',
                },
              ],
            },
            {
              type: 'punctuation' as const,
              alternatives: [
                {
                  content: '?',
                },
              ],
            },
          ],
          speaker_labels: {
            speakers: 2,
            channel_label: 'ch_0',
            segments: [
            {
              start_time: '0.5',
              end_time: '2.3',
              speaker_label: 'spk_0',
              items: [
                {
                  speaker_label: 'spk_0',
                  start_time: '0.5',
                  end_time: '1.0',
                },
                {
                  speaker_label: 'spk_0',
                  start_time: '1.1',
                  end_time: '1.5',
                },
              ],
            },
            {
              start_time: '2.5',
              end_time: '4.0',
              speaker_label: 'spk_1',
              items: [
                {
                  speaker_label: 'spk_1',
                  start_time: '2.5',
                  end_time: '2.8',
                },
                {
                  speaker_label: 'spk_1',
                  start_time: '2.9',
                  end_time: '3.2',
                },
                {
                  speaker_label: 'spk_1',
                  start_time: '3.3',
                  end_time: '3.8',
                },
              ],
            },
          ],
          },
          language_identification: [
            {
              language_code: 'en-US',
              score: '0.95',
            },
          ],
        },
      };

      const segments = parseTranscribeOutput(transcribeResult);

      expect(segments).toHaveLength(2);

      // First segment
      expect(segments[0]).toMatchObject({
        startTime: 500, // 0.5 seconds in milliseconds
        endTime: 2300, // 2.3 seconds in milliseconds
        speakerLabel: 'spk_0',
        text: 'Hello world.',
        languageCode: 'en-US',
      });
      expect(segments[0].confidence).toBeCloseTo(0.985, 2); // Average of 0.99 and 0.98
      expect(segments[0].words).toHaveLength(2);
      expect(segments[0].words[0]).toEqual({
        startTime: 500,
        endTime: 1000,
        text: 'Hello',
        confidence: 0.99,
      });
      expect(segments[0].words[1]).toEqual({
        startTime: 1100,
        endTime: 1500,
        text: 'world.',
        confidence: 0.98,
      });

      // Second segment
      expect(segments[1]).toMatchObject({
        startTime: 2500,
        endTime: 4000,
        speakerLabel: 'spk_1',
        text: 'How are you?',
        languageCode: 'en-US',
      });
      expect(segments[1].confidence).toBeCloseTo(0.96, 2); // Average of 0.97, 0.96, 0.95
      expect(segments[1].words).toHaveLength(3);
      expect(segments[1].words[0]).toEqual({
        startTime: 2500,
        endTime: 2800,
        text: 'How',
        confidence: 0.97,
      });
      expect(segments[1].words[1]).toEqual({
        startTime: 2900,
        endTime: 3200,
        text: 'are',
        confidence: 0.96,
      });
      expect(segments[1].words[2]).toEqual({
        startTime: 3300,
        endTime: 3800,
        text: 'you?',
        confidence: 0.95,
      });
    });

    it('should handle punctuation spacing correctly', () => {
      const transcribeResult = {
        results: {
          transcripts: [{ transcript: 'Hello, world!' }],
          items: [
            {
              start_time: '0.5',
              end_time: '1.0',
              type: 'pronunciation' as const,
              alternatives: [{ content: 'Hello', confidence: '0.99' }],
            },
            {
              type: 'punctuation' as const,
              alternatives: [{ content: ',' }],
            },
            {
              start_time: '1.1',
              end_time: '1.5',
              type: 'pronunciation' as const,
              alternatives: [{ content: 'world', confidence: '0.98' }],
            },
            {
              type: 'punctuation' as const,
              alternatives: [{ content: '!' }],
            },
          ],
          speaker_labels: {
            speakers: 1,
            channel_label: 'ch_0',
            segments: [
              {
                start_time: '0.0',
                end_time: '2.0',
                speaker_label: 'spk_0',
                items: [
                  {
                    speaker_label: 'spk_0',
                    start_time: '0.5',
                    end_time: '1.0',
                  },
                  {
                    speaker_label: 'spk_0',
                    start_time: '1.1',
                    end_time: '1.5',
                  },
                ],
              },
            ],
          },
          language_identification: [
            {
              language_code: 'en-US',
              score: '0.95',
            },
          ],
        },
      };

      const segments = parseTranscribeOutput(transcribeResult);

      expect(segments).toHaveLength(1);
      expect(segments[0].text).toBe('Hello, world!');
    });

    it('should handle multiple languages', () => {
      const transcribeResult = {
        results: {
          transcripts: [{ transcript: 'Hello. Hola.' }],
          items: [
            {
              start_time: '0.5',
              end_time: '1.0',
              type: 'pronunciation' as const,
              alternatives: [{ content: 'Hello', confidence: '0.99' }],
            },
          ],
          speaker_labels: {
            speakers: 1,
            channel_label: 'ch_0',
            segments: [
              {
                start_time: '0.0',
                end_time: '1.0',
                speaker_label: 'spk_0',
                items: [
                  {
                    speaker_label: 'spk_0',
                    start_time: '0.5',
                    end_time: '1.0',
                  },
                ],
              },
            ],
          },
          language_identification: [
            {
              language_code: 'en-US',
              score: '0.60',
            },
            {
              language_code: 'es-ES',
              score: '0.85',
            },
          ],
        },
      };

      const segments = parseTranscribeOutput(transcribeResult);

      expect(segments).toHaveLength(1);
      // Should use the highest confidence language
      expect(segments[0].languageCode).toBe('es-ES');
    });

    it('should default to ro-RO when no language identification is available', () => {
      const transcribeResult = {
        results: {
          transcripts: [{ transcript: 'Hello world' }],
          items: [
            {
              start_time: '0.5',
              end_time: '0.8',
              type: 'pronunciation' as const,
              alternatives: [{ content: 'Hello', confidence: '0.99' }],
            },
            {
              start_time: '0.9',
              end_time: '1.0',
              type: 'pronunciation' as const,
              alternatives: [{ content: 'world', confidence: '0.98' }],
            },
          ],
          speaker_labels: {
            speakers: 1,
            channel_label: 'ch_0',
            segments: [
              {
                start_time: '0.0',
                end_time: '1.0',
                speaker_label: 'spk_0',
                items: [
                  {
                    speaker_label: 'spk_0',
                    start_time: '0.5',
                    end_time: '0.8',
                  },
                  {
                    speaker_label: 'spk_0',
                    start_time: '0.9',
                    end_time: '1.0',
                  },
                ],
              },
            ],
          },
        },
      };

      const segments = parseTranscribeOutput(transcribeResult);

      expect(segments).toHaveLength(1);
      expect(segments[0].languageCode).toBe('ro-RO');
    });

    it('should handle segments with no confidence values', () => {
      const transcribeResult = {
        results: {
          transcripts: [{ transcript: 'Hello' }],
          items: [
            {
              start_time: '0.5',
              end_time: '1.0',
              type: 'pronunciation' as const,
              alternatives: [{ content: 'Hello' }], // No confidence
            },
          ],
          speaker_labels: {
            speakers: 1,
            channel_label: 'ch_0',
            segments: [
              {
                start_time: '0.0',
                end_time: '1.0',
                speaker_label: 'spk_0',
                items: [
                  {
                    speaker_label: 'spk_0',
                    start_time: '0.5',
                    end_time: '1.0',
                  },
                ],
              },
            ],
          },
          language_identification: [
            {
              language_code: 'en-US',
              score: '0.95',
            },
          ],
        },
      };

      const segments = parseTranscribeOutput(transcribeResult);

      expect(segments).toHaveLength(1);
      expect(segments[0].confidence).toBe(1.0); // Default confidence
    });

    it('should convert timestamps to milliseconds correctly', () => {
      const transcribeResult = {
        results: {
          transcripts: [{ transcript: 'Test' }],
          items: [
            {
              start_time: '123.456',
              end_time: '789.012',
              type: 'pronunciation' as const,
              alternatives: [{ content: 'Test', confidence: '0.99' }],
            },
          ],
          speaker_labels: {
            speakers: 1,
            channel_label: 'ch_0',
            segments: [
              {
                start_time: '123.456',
                end_time: '789.012',
                speaker_label: 'spk_0',
                items: [
                  {
                    speaker_label: 'spk_0',
                    start_time: '123.456',
                    end_time: '789.012',
                  },
                ],
              },
            ],
          },
          language_identification: [
            {
              language_code: 'en-US',
              score: '0.95',
            },
          ],
        },
      };

      const segments = parseTranscribeOutput(transcribeResult);

      expect(segments).toHaveLength(1);
      expect(segments[0].startTime).toBe(123456); // Rounded milliseconds
      expect(segments[0].endTime).toBe(789012);
    });

    it('should parse Transcribe output without segments (no diarization)', () => {
      const transcribeResult = {
        results: {
          transcripts: [
            {
              transcript: 'Hello world. How are you today?',
            },
          ],
          items: [
            {
              start_time: '0.5',
              end_time: '1.0',
              type: 'pronunciation' as const,
              alternatives: [
                {
                  content: 'Hello',
                  confidence: '0.99',
                },
              ],
            },
            {
              start_time: '1.1',
              end_time: '1.5',
              type: 'pronunciation' as const,
              alternatives: [
                {
                  content: 'world',
                  confidence: '0.98',
                },
              ],
            },
            {
              type: 'punctuation' as const,
              alternatives: [
                {
                  content: '.',
                },
              ],
            },
            {
              start_time: '2.0',
              end_time: '2.3',
              type: 'pronunciation' as const,
              alternatives: [
                {
                  content: 'How',
                  confidence: '0.97',
                },
              ],
            },
            {
              start_time: '2.4',
              end_time: '2.7',
              type: 'pronunciation' as const,
              alternatives: [
                {
                  content: 'are',
                  confidence: '0.96',
                },
              ],
            },
            {
              start_time: '2.8',
              end_time: '3.1',
              type: 'pronunciation' as const,
              alternatives: [
                {
                  content: 'you',
                  confidence: '0.95',
                },
              ],
            },
            {
              start_time: '3.2',
              end_time: '3.6',
              type: 'pronunciation' as const,
              alternatives: [
                {
                  content: 'today',
                  confidence: '0.94',
                },
              ],
            },
            {
              type: 'punctuation' as const,
              alternatives: [
                {
                  content: '?',
                },
              ],
            },
          ],
        },
      };

      const segments = parseTranscribeOutput(transcribeResult);

      expect(segments).toHaveLength(1);
      expect(segments[0]).toMatchObject({
        startTime: 500,
        endTime: 3600,
        speakerLabel: 'Speaker 1',
        text: 'Hello world. How are you today?',
        languageCode: 'ro-RO', // Default when no language identification
      });
      expect(segments[0].confidence).toBeGreaterThan(0.9);
      
      // Verify word-level data is extracted
      expect(segments[0].words).toHaveLength(6);
      expect(segments[0].words[0]).toEqual({
        startTime: 500,
        endTime: 1000,
        text: 'Hello',
        confidence: 0.99,
      });
      expect(segments[0].words[1]).toEqual({
        startTime: 1100,
        endTime: 1500,
        text: 'world.',
        confidence: 0.98,
      });
      expect(segments[0].words[2]).toEqual({
        startTime: 2000,
        endTime: 2300,
        text: 'How',
        confidence: 0.97,
      });
      expect(segments[0].words[3]).toEqual({
        startTime: 2400,
        endTime: 2700,
        text: 'are',
        confidence: 0.96,
      });
      expect(segments[0].words[4]).toEqual({
        startTime: 2800,
        endTime: 3100,
        text: 'you',
        confidence: 0.95,
      });
      expect(segments[0].words[5]).toEqual({
        startTime: 3200,
        endTime: 3600,
        text: 'today?',
        confidence: 0.94,
      });
    });

    it('should split items into multiple segments based on time windows', () => {
      const transcribeResult = {
        results: {
          transcripts: [{ transcript: 'First part. Second part after long pause.' }],
          items: [
            {
              start_time: '0.0',
              end_time: '0.5',
              type: 'pronunciation' as const,
              alternatives: [{ content: 'First', confidence: '0.99' }],
            },
            {
              start_time: '0.6',
              end_time: '1.0',
              type: 'pronunciation' as const,
              alternatives: [{ content: 'part', confidence: '0.98' }],
            },
            {
              type: 'punctuation' as const,
              alternatives: [{ content: '.' }],
            },
            {
              start_time: '35.0', // 35 seconds later - should trigger new segment
              end_time: '35.5',
              type: 'pronunciation' as const,
              alternatives: [{ content: 'Second', confidence: '0.97' }],
            },
            {
              start_time: '35.6',
              end_time: '36.0',
              type: 'pronunciation' as const,
              alternatives: [{ content: 'part', confidence: '0.96' }],
            },
            {
              start_time: '36.1',
              end_time: '36.5',
              type: 'pronunciation' as const,
              alternatives: [{ content: 'after', confidence: '0.95' }],
            },
            {
              start_time: '36.6',
              end_time: '37.0',
              type: 'pronunciation' as const,
              alternatives: [{ content: 'long', confidence: '0.94' }],
            },
            {
              start_time: '37.1',
              end_time: '37.5',
              type: 'pronunciation' as const,
              alternatives: [{ content: 'pause', confidence: '0.93' }],
            },
            {
              type: 'punctuation' as const,
              alternatives: [{ content: '.' }],
            },
          ],
        },
      };

      const segments = parseTranscribeOutput(transcribeResult);

      expect(segments).toHaveLength(2);
      expect(segments[0].text).toBe('First part.');
      expect(segments[0].speakerLabel).toBe('Speaker 1');
      expect(segments[1].text).toBe('Second part after long pause.');
      expect(segments[1].speakerLabel).toBe('Speaker 2');
      
      // Verify word-level data is extracted for both segments
      expect(segments[0].words).toHaveLength(2);
      expect(segments[0].words[0]).toEqual({
        startTime: 0,
        endTime: 500,
        text: 'First',
        confidence: 0.99,
      });
      expect(segments[0].words[1]).toEqual({
        startTime: 600,
        endTime: 1000,
        text: 'part.',
        confidence: 0.98,
      });
      
      expect(segments[1].words).toHaveLength(5);
      expect(segments[1].words[0]).toEqual({
        startTime: 35000,
        endTime: 35500,
        text: 'Second',
        confidence: 0.97,
      });
      expect(segments[1].words[1]).toEqual({
        startTime: 35600,
        endTime: 36000,
        text: 'part',
        confidence: 0.96,
      });
      expect(segments[1].words[2]).toEqual({
        startTime: 36100,
        endTime: 36500,
        text: 'after',
        confidence: 0.95,
      });
      expect(segments[1].words[3]).toEqual({
        startTime: 36600,
        endTime: 37000,
        text: 'long',
        confidence: 0.94,
      });
      expect(segments[1].words[4]).toEqual({
        startTime: 37100,
        endTime: 37500,
        text: 'pause.',
        confidence: 0.93,
      });
    });

    it('should throw error when no items or segments are found', () => {
      const transcribeResult = {
        results: {
          transcripts: [{ transcript: '' }],
          items: [],
          segments: [],
        },
      };

      expect(() => parseTranscribeOutput(transcribeResult)).toThrow(
        'No items found in Transcribe output'
      );
    });

    it('should handle empty text in segments', () => {
      const transcribeResult = {
        results: {
          transcripts: [{ transcript: '' }],
          items: [],
          speaker_labels: {
            speakers: 1,
            channel_label: 'ch_0',
            segments: [
              {
                start_time: '0.0',
                end_time: '1.0',
                speaker_label: 'spk_0',
                items: [],
              },
            ],
          },
          language_identification: [
            {
              language_code: 'en-US',
              score: '0.95',
            },
          ],
        },
      };

      const segments = parseTranscribeOutput(transcribeResult);

      expect(segments).toHaveLength(1);
      expect(segments[0].text).toBe('');
    });

    it('should handle multiple speakers in sequence', () => {
      const transcribeResult = {
        results: {
          transcripts: [{ transcript: 'Speaker one. Speaker two. Speaker three.' }],
          items: [
            {
              start_time: '0.5',
              end_time: '1.0',
              type: 'pronunciation' as const,
              alternatives: [{ content: 'Speaker', confidence: '0.99' }],
            },
            {
              start_time: '1.1',
              end_time: '1.5',
              type: 'pronunciation' as const,
              alternatives: [{ content: 'one', confidence: '0.98' }],
            },
            {
              type: 'punctuation' as const,
              alternatives: [{ content: '.' }],
            },
            {
              start_time: '2.6',
              end_time: '3.0',
              type: 'pronunciation' as const,
              alternatives: [{ content: 'Speaker', confidence: '0.97' }],
            },
            {
              start_time: '3.1',
              end_time: '3.5',
              type: 'pronunciation' as const,
              alternatives: [{ content: 'two', confidence: '0.96' }],
            },
            {
              type: 'punctuation' as const,
              alternatives: [{ content: '.' }],
            },
            {
              start_time: '5.5',
              end_time: '6.0',
              type: 'pronunciation' as const,
              alternatives: [{ content: 'Speaker', confidence: '0.95' }],
            },
            {
              start_time: '6.1',
              end_time: '6.5',
              type: 'pronunciation' as const,
              alternatives: [{ content: 'three', confidence: '0.94' }],
            },
            {
              type: 'punctuation' as const,
              alternatives: [{ content: '.' }],
            },
          ],
          speaker_labels: {
            speakers: 3,
            channel_label: 'ch_0',
            segments: [
              {
                start_time: '0.0',
                end_time: '2.0',
                speaker_label: 'spk_0',
                items: [
                  {
                    speaker_label: 'spk_0',
                    start_time: '0.5',
                    end_time: '1.0',
                  },
                  {
                    speaker_label: 'spk_0',
                    start_time: '1.1',
                    end_time: '1.5',
                  },
                ],
              },
              {
                start_time: '2.5',
                end_time: '4.5',
                speaker_label: 'spk_1',
                items: [
                  {
                    speaker_label: 'spk_1',
                    start_time: '2.6',
                    end_time: '3.0',
                  },
                  {
                    speaker_label: 'spk_1',
                    start_time: '3.1',
                    end_time: '3.5',
                  },
                ],
              },
              {
                start_time: '5.0',
                end_time: '7.0',
                speaker_label: 'spk_2',
                items: [
                  {
                    speaker_label: 'spk_2',
                    start_time: '5.5',
                    end_time: '6.0',
                  },
                  {
                    speaker_label: 'spk_2',
                    start_time: '6.1',
                    end_time: '6.5',
                  },
                ],
              },
            ],
          },
          language_identification: [
            {
              language_code: 'en-US',
              score: '0.95',
            },
          ],
        },
      };

      const segments = parseTranscribeOutput(transcribeResult);

      expect(segments).toHaveLength(3);
      expect(segments[0].speakerLabel).toBe('spk_0');
      expect(segments[1].speakerLabel).toBe('spk_1');
      expect(segments[2].speakerLabel).toBe('spk_2');
      expect(segments[0].text).toBe('Speaker one.');
      expect(segments[1].text).toBe('Speaker two.');
      expect(segments[2].text).toBe('Speaker three.');
    });

    it('should handle segments with no word-level data (empty items array)', () => {
      const transcribeResult = {
        results: {
          transcripts: [{ transcript: '' }],
          items: [],
          speaker_labels: {
            speakers: 1,
            channel_label: 'ch_0',
            segments: [
              {
                start_time: '0.0',
                end_time: '1.0',
                speaker_label: 'spk_0',
                items: [],
              },
            ],
          },
          language_identification: [
            {
              language_code: 'en-US',
              score: '0.95',
            },
          ],
        },
      };

      const segments = parseTranscribeOutput(transcribeResult);

      expect(segments).toHaveLength(1);
      expect(segments[0].words).toEqual([]);
      expect(segments[0].text).toBe('');
    });

    it('should handle segments with only punctuation items (no word-level data)', () => {
      const transcribeResult = {
        results: {
          transcripts: [{ transcript: '...' }],
          items: [
            {
              type: 'punctuation' as const,
              alternatives: [{ content: '.' }],
            },
            {
              type: 'punctuation' as const,
              alternatives: [{ content: '.' }],
            },
            {
              type: 'punctuation' as const,
              alternatives: [{ content: '.' }],
            },
          ],
          speaker_labels: {
            speakers: 1,
            channel_label: 'ch_0',
            segments: [
              {
                start_time: '0.0',
                end_time: '1.0',
                speaker_label: 'spk_0',
                items: [],
              },
            ],
          },
          language_identification: [
            {
              language_code: 'en-US',
              score: '0.95',
            },
          ],
        },
      };

      const segments = parseTranscribeOutput(transcribeResult);

      expect(segments).toHaveLength(1);
      expect(segments[0].words).toEqual([]);
      expect(segments[0].text).toBe('');
    });

    it('should handle segments with items missing timestamps', () => {
      const transcribeResult = {
        results: {
          transcripts: [{ transcript: 'Hello world' }],
          items: [
            {
              type: 'pronunciation' as const,
              alternatives: [{ content: 'Hello', confidence: '0.99' }],
              // Missing start_time and end_time
            },
            {
              start_time: '1.0',
              end_time: '1.5',
              type: 'pronunciation' as const,
              alternatives: [{ content: 'world', confidence: '0.98' }],
            },
          ],
          speaker_labels: {
            speakers: 1,
            channel_label: 'ch_0',
            segments: [
              {
                start_time: '0.0',
                end_time: '2.0',
                speaker_label: 'spk_0',
                items: [
                  {
                    speaker_label: 'spk_0',
                    start_time: '1.0',
                    end_time: '1.5',
                  },
                ],
              },
            ],
          },
          language_identification: [
            {
              language_code: 'en-US',
              score: '0.95',
            },
          ],
        },
      };

      const segments = parseTranscribeOutput(transcribeResult);

      expect(segments).toHaveLength(1);
      expect(segments[0].text).toBe('world');
      expect(segments[0].words).toHaveLength(1); // Only 'world' has timestamps
      expect(segments[0].words[0]).toEqual({
        startTime: 1000,
        endTime: 1500,
        text: 'world',
        confidence: 0.98,
      });
    });
  });
});
