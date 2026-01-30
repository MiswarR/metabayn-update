import { Env } from '../types';
 

export async function getFallbackChain(userModel: string, env: Env): Promise<string[]> {
  return [userModel];
}
