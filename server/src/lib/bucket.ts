import { S3 } from 'aws-sdk';
import { getConfig } from '../config-helper';
import Model from './model';
import { Sentence, Clip } from 'common';
/**
 * Bucket
 *   The bucket class is responsible for loading clip
 *   metadata into the Model from s3.
 */
export default class Bucket {
  private model: Model;
  private s3: S3;

  constructor(model: Model, s3: S3) {
    this.model = model;
    this.s3 = s3;
  }

  /**
   * Fetch a public url for the resource.
   */
  private getPublicUrl(key: string) {
    return this.s3.getSignedUrl('getObject', {
      Bucket: getConfig().BUCKET_NAME,
      Key: key,
      Expires: 60 * 60 * 12,
    });
  }

  /**
   * Grab metadata to play clip on the front end.
   */
  async getRandomClips(
    client_id: string,
    locale: string,
    count: number
  ): Promise<Clip[]> {
    // Get more clip IDs than are required in case some are broken links or clips
    const clips = await this.model.findEligibleClips(
      client_id,
      locale,
      Math.ceil(count * 1.5)
    );
    const clipPromises: Clip[] = [];

    // Use for instead of .map so that it can break once enough clips are assembled
    for (let i = 0; i < clips.length; i++) {
      const { id, path, sentence, original_sentence_id, taxonomy } = clips[i];

      try {
        const metadata = await this.s3
          .headObject({
            Bucket: getConfig().BUCKET_NAME,
            Key: path,
          })
          .promise();

        if (metadata.ContentLength >= 256) {
          clipPromises.push({
            id: id.toString(),
            glob: path.replace('.mp3', ''),
            sentence: { id: original_sentence_id, text: sentence, taxonomy },
            audioSrc: this.getPublicUrl(path),
          });
        } else {
          console.log(
            `clip_id ${id} by ${client_id} for sentence ${original_sentence_id} is smaller than 256 bytes`
          );
          this.deleteClip(id, client_id, original_sentence_id);
        }

        if (clipPromises.length == count) break;
      } catch (e) {
        console.log(`aws error retrieving clip_id ${id}`);
      }
    }

    return Promise.all(clipPromises);
  }

  getAvatarClipsUrl(path: string) {
    return this.getPublicUrl(path);
  }

  deleteClip(clipId: number, clientId: string, sentenceId: string) {
    this.model.db.deleteClip(clipId);

    this.s3.deleteObject(
      {
        Bucket: getConfig().BUCKET_NAME,
        Key: `${clientId}/${sentenceId}`,
      },
      () => {
        console.log(
          `clip_id ${clipId} by ${clientId} for sentence ${sentenceId} has been removed`
        );
      }
    );
  }

  async getClipUrl(id: string): Promise<string> {
    const clip = await this.model.db.findClip(id);
    return this.getPublicUrl(clip.path);
  }
}
