import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { ValidationPipe } from '@nestjs/common'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true }),
  )

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))

  await app.register(require('@fastify/cors'), {
    origin: 'http://localhost:5173',
    credentials: true,
  })

  const port = process.env.PORT ?? 3000
  await app.listen(port, '0.0.0.0')
}

bootstrap()
