package com.proteros.smsai.util

import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.MonthDay
import java.time.ZoneId

object BusinessCalendar {

    val ZONE: ZoneId = ZoneId.of("Europe/Vilnius")

    fun isLithuanianHoliday(date: LocalDate): Boolean {
        val year = date.year
        val fixed = setOf(
            MonthDay.of(1, 1),
            MonthDay.of(2, 16),
            MonthDay.of(3, 11),
            MonthDay.of(5, 1),
            MonthDay.of(6, 24),
            MonthDay.of(7, 6),
            MonthDay.of(8, 15),
            MonthDay.of(11, 1),
            MonthDay.of(11, 2),
            MonthDay.of(12, 24),
            MonthDay.of(12, 25),
            MonthDay.of(12, 26),
        )
        if (fixed.contains(MonthDay.from(date))) return true
        val a = year % 19; val b = year / 100; val c = year % 100
        val d = b / 4; val e = b % 4; val f = (b + 8) / 25
        val g = (b - f + 1) / 3; val h = (19 * a + b - d - g + 15) % 30
        val i = c / 4; val k = c % 4; val l = (32 + 2 * e + 2 * i - h - k) % 7
        val m = (a + 11 * h + 22 * l) / 451
        val month = (h + l - 7 * m + 114) / 31; val day = (h + l - 7 * m + 114) % 31 + 1
        val easter = LocalDate.of(year, month, day)
        return date == easter || date == easter.plusDays(1)
    }

    fun findNextSlot(from: LocalDateTime): LocalDateTime {
        var slot = from
        while (true) {
            val dow = slot.dayOfWeek
            val hour = slot.hour
            when {
                dow == DayOfWeek.SUNDAY || isLithuanianHoliday(slot.toLocalDate()) ->
                    slot = slot.plusDays(1).withHour(8).withMinute(0)
                dow == DayOfWeek.SATURDAY && hour >= 13 -> slot = slot.plusDays(2).withHour(8).withMinute(0)
                dow == DayOfWeek.SATURDAY && hour < 9 -> slot = slot.withHour(9).withMinute(0)
                hour >= 16 -> slot = slot.plusDays(1).withHour(8).withMinute(0)
                hour < 8 -> slot = slot.withHour(8).withMinute(0)
                else -> return slot.withMinute(0).withSecond(0)
            }
        }
    }

    fun isBusinessHours(now: LocalDateTime): Boolean {
        val dow = now.dayOfWeek
        if (dow == DayOfWeek.SUNDAY || dow == DayOfWeek.SATURDAY) return false
        if (isLithuanianHoliday(now.toLocalDate())) return false
        return now.hour in 8..16
    }
}
