package com.proteros.smsai.util

import org.junit.Assert.*
import org.junit.Test
import java.time.LocalDate
import java.time.LocalDateTime

class BusinessCalendarTest {

    // --- Holiday detection ---

    @Test
    fun `New Year is a holiday`() {
        assertTrue(BusinessCalendar.isLithuanianHoliday(LocalDate.of(2025, 1, 1)))
    }

    @Test
    fun `Independence day March 11`() {
        assertTrue(BusinessCalendar.isLithuanianHoliday(LocalDate.of(2025, 3, 11)))
    }

    @Test
    fun `Christmas Eve and both Christmas days`() {
        assertTrue(BusinessCalendar.isLithuanianHoliday(LocalDate.of(2025, 12, 24)))
        assertTrue(BusinessCalendar.isLithuanianHoliday(LocalDate.of(2025, 12, 25)))
        assertTrue(BusinessCalendar.isLithuanianHoliday(LocalDate.of(2025, 12, 26)))
    }

    @Test
    fun `Easter 2025 is April 20 Sunday`() {
        assertTrue(BusinessCalendar.isLithuanianHoliday(LocalDate.of(2025, 4, 20)))
        assertTrue(BusinessCalendar.isLithuanianHoliday(LocalDate.of(2025, 4, 21)))
    }

    @Test
    fun `Easter 2026 is April 5`() {
        assertTrue(BusinessCalendar.isLithuanianHoliday(LocalDate.of(2026, 4, 5)))
        assertTrue(BusinessCalendar.isLithuanianHoliday(LocalDate.of(2026, 4, 6)))
    }

    @Test
    fun `Regular workday is not a holiday`() {
        assertFalse(BusinessCalendar.isLithuanianHoliday(LocalDate.of(2025, 6, 18)))
    }

    // --- Business hours ---

    @Test
    fun `Monday 10am is business hours`() {
        assertTrue(BusinessCalendar.isBusinessHours(LocalDateTime.of(2025, 6, 16, 10, 0)))
    }

    @Test
    fun `Saturday is not business hours`() {
        assertFalse(BusinessCalendar.isBusinessHours(LocalDateTime.of(2025, 6, 21, 10, 0)))
    }

    @Test
    fun `Sunday is not business hours`() {
        assertFalse(BusinessCalendar.isBusinessHours(LocalDateTime.of(2025, 6, 22, 10, 0)))
    }

    @Test
    fun `7am Monday is outside business hours`() {
        assertFalse(BusinessCalendar.isBusinessHours(LocalDateTime.of(2025, 6, 16, 7, 0)))
    }

    @Test
    fun `5pm Monday is outside business hours`() {
        assertFalse(BusinessCalendar.isBusinessHours(LocalDateTime.of(2025, 6, 16, 17, 0)))
    }

    @Test
    fun `Holiday weekday is not business hours`() {
        assertFalse(BusinessCalendar.isBusinessHours(LocalDateTime.of(2025, 12, 25, 10, 0)))
    }

    // --- Slot finding ---

    @Test
    fun `Weekday 10am returns same hour`() {
        val slot = BusinessCalendar.findNextSlot(LocalDateTime.of(2025, 6, 16, 10, 30))
        assertEquals(LocalDateTime.of(2025, 6, 16, 10, 0, 0), slot)
    }

    @Test
    fun `Weekday before 8am returns 8am`() {
        val slot = BusinessCalendar.findNextSlot(LocalDateTime.of(2025, 6, 16, 6, 0))
        assertEquals(LocalDateTime.of(2025, 6, 16, 8, 0, 0), slot)
    }

    @Test
    fun `Weekday after 4pm returns next day 8am`() {
        val slot = BusinessCalendar.findNextSlot(LocalDateTime.of(2025, 6, 16, 17, 0))
        assertEquals(LocalDateTime.of(2025, 6, 17, 8, 0, 0), slot)
    }

    @Test
    fun `Sunday returns Monday 8am`() {
        val slot = BusinessCalendar.findNextSlot(LocalDateTime.of(2025, 6, 22, 10, 0))
        assertEquals(LocalDateTime.of(2025, 6, 23, 8, 0, 0), slot)
    }

    @Test
    fun `Saturday after 1pm returns Monday 8am`() {
        val slot = BusinessCalendar.findNextSlot(LocalDateTime.of(2025, 6, 21, 14, 0))
        assertEquals(LocalDateTime.of(2025, 6, 23, 8, 0, 0), slot)
    }

    @Test
    fun `Saturday before 9am returns Monday 8am`() {
        val slot = BusinessCalendar.findNextSlot(LocalDateTime.of(2025, 6, 21, 7, 0))
        assertEquals(LocalDateTime.of(2025, 6, 23, 8, 0, 0), slot)
    }

    @Test
    fun `Holiday skips to next workday`() {
        // 2025-12-25 is Thursday (holiday), 12-26 is Friday (holiday), next workday is Monday 12-29
        val slot = BusinessCalendar.findNextSlot(LocalDateTime.of(2025, 12, 25, 10, 0))
        assertEquals(LocalDateTime.of(2025, 12, 29, 8, 0, 0), slot)
    }

    // --- parseWorkingHours ---

    @Test
    fun `parseWorkingHours standard format`() {
        assertEquals(8 to 17, BusinessCalendar.parseWorkingHours("I-V 8:00-17:00"))
    }

    @Test
    fun `parseWorkingHours extended hours`() {
        assertEquals(7 to 20, BusinessCalendar.parseWorkingHours("I-V 7:00-20:00"))
    }

    @Test
    fun `parseWorkingHours custom business hours`() {
        assertTrue(BusinessCalendar.isBusinessHours(LocalDateTime.of(2025, 6, 16, 19, 0), 8, 20))
        assertFalse(BusinessCalendar.isBusinessHours(LocalDateTime.of(2025, 6, 16, 19, 0), 8, 17))
    }

    @Test
    fun `Friday 4pm returns Monday 8am`() {
        val slot = BusinessCalendar.findNextSlot(LocalDateTime.of(2025, 6, 20, 16, 0))
        assertEquals(LocalDateTime.of(2025, 6, 23, 8, 0, 0), slot)
    }
}
