package com.proteros.smsai.ui

import android.graphics.Typeface
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import com.proteros.smsai.AutoShopApp
import com.proteros.smsai.R
import com.proteros.smsai.databinding.FragmentWeekBinding
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.time.temporal.TemporalAdjusters
import java.util.Locale

class WeekFragment : Fragment() {

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density + 0.5f).toInt()

    private var _binding: FragmentWeekBinding? = null
    private val binding get() = _binding!!
    private val viewModel: TodayViewModel by viewModels {
        TodayViewModel.Factory((requireActivity().application as AutoShopApp).repository)
    }

    private var currentWeekStart: LocalDate = LocalDate.now().with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentWeekBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        binding.btnPrevWeek.setOnClickListener {
            currentWeekStart = currentWeekStart.minusWeeks(1)
            updateWeek()
        }
        binding.btnNextWeek.setOnClickListener {
            currentWeekStart = currentWeekStart.plusWeeks(1)
            updateWeek()
        }

        viewModel.appointments.observe(viewLifecycleOwner) {
            updateWeek()
        }

        updateWeek()
    }

    private fun updateWeek() {
        val ctx = context ?: return
        val today = LocalDate.now()
        val ltLocale = Locale("lt")

        val monthName = currentWeekStart.format(DateTimeFormatter.ofPattern("yyyy MMMM", ltLocale))
            .replaceFirstChar { it.uppercaseChar() }
        binding.weekTitle.text = monthName

        // Day headers
        binding.dayHeaders.removeAllViews()
        val days = listOf("Pr", "An", "Tr", "Kt", "Pn")
        for (i in 0 until 5) {
            val date = currentWeekStart.plusDays(i.toLong())
            val isToday = date == today

            val col = LinearLayout(ctx).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f)
                if (isToday) {
                    setBackgroundColor(ContextCompat.getColor(ctx, R.color.accent))
                }
            }

            val dayLabel = TextView(ctx).apply {
                text = days[i]
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
                gravity = Gravity.CENTER
                setTextColor(if (isToday) 0xFFFFFFFF.toInt() else ContextCompat.getColor(ctx, R.color.text_secondary))
            }

            val dateLabel = TextView(ctx).apply {
                text = date.dayOfMonth.toString()
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
                setTypeface(null, Typeface.BOLD)
                gravity = Gravity.CENTER
                setTextColor(if (isToday) 0xFFFFFFFF.toInt() else ContextCompat.getColor(ctx, R.color.text_primary))
            }

            col.addView(dayLabel)
            col.addView(dateLabel)
            binding.dayHeaders.addView(col)
        }

        // Build time grid
        binding.gridContainer.removeAllViews()
        val hours = listOf(8, 9, 10, 11, 12, 13, 14, 15, 16)
        val rowHeightDp = 56
        val rowHeightPx = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, rowHeightDp.toFloat(), resources.displayMetrics).toInt()
        val leftMarginPx = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 48f, resources.displayMetrics).toInt()

        val appointments = viewModel.appointments.value ?: emptyList()

        for (hour in hours) {
            val row = FrameLayout(ctx).apply {
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, rowHeightPx)
            }

            // Time label
            val timeLabel = TextView(ctx).apply {
                text = String.format("%02d:00", hour)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 10f)
                setTextColor(ContextCompat.getColor(ctx, R.color.text_secondary))
                layoutParams = FrameLayout.LayoutParams(leftMarginPx, FrameLayout.LayoutParams.WRAP_CONTENT).apply {
                    topMargin = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 2f, resources.displayMetrics).toInt()
                    leftMargin = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 4f, resources.displayMetrics).toInt()
                }
            }
            row.addView(timeLabel)

            // Grid line
            val line = View(ctx).apply {
                setBackgroundColor(0xFFE0E0E0.toInt())
                layoutParams = FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, 1).apply {
                    leftMargin = leftMarginPx
                }
            }
            row.addView(line)

            // Cells container
            val cellsContainer = LinearLayout(ctx).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutParams = FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.MATCH_PARENT
                ).apply {
                    leftMargin = leftMarginPx
                }
            }

            for (dayOffset in 0 until 5) {
                val date = currentWeekStart.plusDays(dayOffset.toLong())
                val cell = FrameLayout(ctx).apply {
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply {
                        marginStart = 1
                        marginEnd = 1
                    }
                }

                val appt = appointments.find { a ->
                    try {
                        val dt = LocalDateTime.parse(a.time, DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm"))
                        dt.toLocalDate() == date && dt.hour == hour
                    } catch (_: Exception) { false }
                }

                if (appt != null) {
                    val colors = intArrayOf(0xFF2E7D32.toInt(), 0xFF1565C0.toInt(), 0xFFC0392B.toInt(), 0xFFFF6F00.toInt())
                    val color = colors[dayOffset % colors.size]

                    val block = LinearLayout(ctx).apply {
                        orientation = LinearLayout.VERTICAL
                        val pad = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 3f, resources.displayMetrics).toInt()
                        setPadding(pad, pad, pad, pad)
                        val gd = android.graphics.drawable.GradientDrawable().apply {
                            setColor(color)
                            cornerRadius = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 6f, resources.displayMetrics)
                        }
                        background = gd
                        layoutParams = FrameLayout.LayoutParams(
                            FrameLayout.LayoutParams.MATCH_PARENT,
                            FrameLayout.LayoutParams.MATCH_PARENT
                        ).apply {
                            topMargin = 2
                            bottomMargin = 2
                        }
                    }

                    val nameLabel = TextView(ctx).apply {
                        text = appt.contactName ?: appt.client.takeLast(6)
                        setTextSize(TypedValue.COMPLEX_UNIT_SP, 10f)
                        setTypeface(null, Typeface.BOLD)
                        setTextColor(0xFFFFFFFF.toInt())
                        maxLines = 1
                    }
                    block.addView(nameLabel)

                    val serviceLabel = TextView(ctx).apply {
                        text = appt.service.split(" ").first()
                        setTextSize(TypedValue.COMPLEX_UNIT_SP, 8f)
                        setTextColor(0xCCFFFFFF.toInt())
                        maxLines = 1
                    }
                    block.addView(serviceLabel)

                    val apptRef = appt
                    val apptDate = date
                    val apptHour = hour
                    block.setOnClickListener {
                        val timeStr = String.format("%02d:00", apptHour)
                        val dateStr = apptDate.format(DateTimeFormatter.ofPattern("yyyy-MM-dd"))
                        val dayName = apptDate.format(DateTimeFormatter.ofPattern("EEEE", Locale("lt")))
                            .replaceFirstChar { c -> c.uppercaseChar() }
                        val clientName = apptRef.contactName ?: "Nežinomas"
                        val phone = apptRef.client

                        val dialogView = LinearLayout(ctx).apply {
                            orientation = LinearLayout.VERTICAL
                            setPadding(dp(24), dp(20), dp(24), dp(8))

                            addView(TextView(ctx).apply {
                                text = apptRef.service
                                setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
                                setTypeface(null, Typeface.BOLD)
                                setTextColor(0xFF1B5E20.toInt())
                            })

                            addView(android.view.View(ctx).apply {
                                setBackgroundColor(0xFFE0E0E0.toInt())
                                layoutParams = LinearLayout.LayoutParams(
                                    LinearLayout.LayoutParams.MATCH_PARENT, dp(1)
                                ).apply { setMargins(0, dp(12), 0, dp(16)) }
                            })

                            fun addRow(icon: String, label: String, value: String) {
                                addView(LinearLayout(ctx).apply {
                                    orientation = LinearLayout.HORIZONTAL
                                    setPadding(0, dp(4), 0, dp(4))
                                    addView(TextView(ctx).apply {
                                        text = icon
                                        setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
                                        layoutParams = LinearLayout.LayoutParams(dp(32), LinearLayout.LayoutParams.WRAP_CONTENT)
                                    })
                                    addView(LinearLayout(ctx).apply {
                                        orientation = LinearLayout.VERTICAL
                                        addView(TextView(ctx).apply {
                                            text = label
                                            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
                                            setTextColor(0xFF999999.toInt())
                                        })
                                        addView(TextView(ctx).apply {
                                            text = value
                                            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
                                            setTextColor(0xFF212121.toInt())
                                        })
                                    })
                                })
                            }

                            addRow("📅", "Data", "$dayName, $dateStr")
                            addRow("🕐", "Laikas", timeStr)
                            addRow("👤", "Klientas", clientName)
                            addRow("📞", "Telefonas", phone)
                        }

                        AlertDialog.Builder(ctx)
                            .setView(dialogView)
                            .setPositiveButton("UŽDARYTI", null)
                            .show()
                    }

                    cell.addView(block)
                }

                cellsContainer.addView(cell)
            }

            row.addView(cellsContainer)
            binding.gridContainer.addView(row)
        }

        // Summary
        val totalAppts = appointments.size
        val weekAppts = appointments.count { a ->
            try {
                val dt = LocalDateTime.parse(a.time, DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm"))
                val d = dt.toLocalDate()
                !d.isBefore(currentWeekStart) && d.isBefore(currentWeekStart.plusDays(5))
            } catch (_: Exception) { false }
        }
        val totalSlots = 5 * 9
        val freeSlots = totalSlots - weekAppts
        val occupancy = if (totalSlots > 0) (weekAppts * 100 / totalSlots) else 0
        binding.summaryStats.text = "$weekAppts vizitų  •  $freeSlots laisvi  •  ${occupancy}% užimta"
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
