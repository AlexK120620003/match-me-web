/**
 * Apollo Server setup — mounts GraphQL at /graphql.
 * Playground (Apollo Sandbox) is only available when isDev = true (pass -d flag).
 */
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@as-integrations/express4';
import { ApolloServerPluginLandingPageLocalDefault } from '@apollo/server/plugin/landingPage/default';
import { ApolloServerPluginLandingPageDisabled } from '@apollo/server/plugin/disabled';
import jwt from 'jsonwebtoken';
import type { Express } from 'express';
import { env } from '../config/env';
import { typeDefs } from './typeDefs';
import { resolvers } from './resolvers';
import type { GqlContext } from './resolvers';

export async function mountGraphQL(app: Express, isDev: boolean) {
  const server = new ApolloServer<GqlContext>({
    typeDefs,
    resolvers,
    introspection: isDev,
    plugins: [
      isDev
        ? ApolloServerPluginLandingPageLocalDefault()
        : ApolloServerPluginLandingPageDisabled(),
    ],
  });

  await server.start();

  app.use(
    '/graphql',
    expressMiddleware(server, {
      context: async ({ req }): Promise<GqlContext> => {
        const header = req.headers.authorization;
        if (!header?.startsWith('Bearer ')) return { userId: null };
        try {
          const payload = jwt.verify(header.slice(7), env.JWT_SECRET) as { sub: string };
          return { userId: payload.sub };
        } catch {
          return { userId: null };
        }
      },
    }),
  );
}
