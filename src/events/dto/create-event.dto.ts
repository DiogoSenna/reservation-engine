import { IsString, IsDateString, IsNumber, IsPositive, IsInt, MinLength } from 'class-validator'

export class CreateEventDto {
  @IsString()
  @MinLength(1)
  name!: string

  @IsString()
  @MinLength(1)
  venue!: string

  @IsDateString()
  eventDate!: string

  @IsInt()
  @IsPositive()
  totalCapacity!: number

  @IsNumber()
  @IsPositive()
  price!: number
}
