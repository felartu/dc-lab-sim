import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import type { ExamBreakdown, ExamQuestion, ExamState } from "@/types/scenarios";

// ============================================================================
// Mock data
// ============================================================================

const mockQuestions: ExamQuestion[] = [
  {
    id: "q1",
    domain: "domain1",
    questionText: "What command checks GPU status?",
    type: "multiple-choice",
    choices: ["nvidia-smi", "lspci", "dmesg", "top"],
    correctAnswer: 0,
    explanation: "nvidia-smi shows GPU status.",
    points: 1,
    difficulty: "beginner",
  },
  {
    id: "q2",
    domain: "domain2",
    questionText: "Which tool monitors InfiniBand?",
    type: "multiple-choice",
    choices: ["ibstat", "ifconfig", "netstat", "ss"],
    correctAnswer: 0,
    explanation: "ibstat shows InfiniBand adapter status.",
    points: 1,
    difficulty: "beginner",
  },
  {
    id: "q3",
    domain: "domain4",
    questionText: "Select all DCGM diagnostic levels.",
    type: "multiple-select",
    choices: ["Level 1", "Level 2", "Level 3", "Level 4"],
    correctAnswer: [0, 1, 2],
    explanation: "DCGM supports diagnostic levels 1-3.",
    points: 2,
    difficulty: "intermediate",
  },
];

// ============================================================================
// Store mock
// ============================================================================

const mockStartExam = vi.fn();
const mockSubmitExamAnswer = vi.fn();
const mockToggleQuestionFlag = vi.fn();
const mockEndExam = vi.fn();
const mockExitExam = vi.fn();

let mockActiveExam: ExamState | null = null;

vi.mock("@/store/simulationStore", () => ({
  useSimulationStore: vi.fn(() => ({
    activeExam: mockActiveExam,
    startExam: mockStartExam,
    submitExamAnswer: mockSubmitExamAnswer,
    toggleQuestionFlag: mockToggleQuestionFlag,
    endExam: mockEndExam,
    exitExam: mockExitExam,
  })),
}));

const mockAddExamAttempt = vi.fn();
let mockExamAttempts: ExamBreakdown[] = [];

vi.mock("@/store/learningStore", () => ({
  useLearningStore: vi.fn((selector?: unknown) => {
    const state = {
      addExamAttempt: mockAddExamAttempt,
      examAttempts: mockExamAttempts,
    };
    return typeof selector === "function" ? selector(state) : state;
  }),
}));

// ============================================================================
// examEngine mock
// ============================================================================

const mockTimerStart = vi.fn();
const mockTimerStop = vi.fn();
const mockTimerGetTimeElapsed = vi.fn().mockReturnValue(120);

vi.mock("@/utils/examEngine", () => ({
  loadExamQuestions: vi.fn(),
  selectExamQuestions: vi.fn(),
  selectQuestionsForMode: vi.fn(),
  getIncorrectQuestionIds: vi.fn().mockReturnValue(["q2"]),
  createExamConfig: vi.fn().mockReturnValue({
    mode: "full-practice",
    name: "Full Practice Exam",
    description: "Complete 60-question exam",
    questionCount: 60,
    timeLimitMinutes: 90,
    shuffleQuestions: true,
    showExplanations: "after-exam",
  }),
  calculateExamScore: vi.fn().mockReturnValue({
    totalPoints: 4,
    earnedPoints: 2,
    percentage: 50,
    byDomain: {
      domain1: {
        domainName: "Platform Bring-Up",
        questionsTotal: 1,
        questionsCorrect: 1,
        percentage: 100,
        weight: 31,
      },
      domain2: {
        domainName: "Accelerator Configuration",
        questionsTotal: 1,
        questionsCorrect: 0,
        percentage: 0,
        weight: 5,
      },
      domain3: {
        domainName: "Base Infrastructure",
        questionsTotal: 0,
        questionsCorrect: 0,
        percentage: 0,
        weight: 19,
      },
      domain4: {
        domainName: "Validation & Testing",
        questionsTotal: 1,
        questionsCorrect: 1,
        percentage: 100,
        weight: 33,
      },
      domain5: {
        domainName: "Troubleshooting",
        questionsTotal: 0,
        questionsCorrect: 0,
        percentage: 0,
        weight: 12,
      },
    },
    questionResults: [],
    timeSpent: 0,
  }),
  ExamTimer: vi.fn().mockImplementation(() => ({
    start: mockTimerStart,
    stop: mockTimerStop,
    getTimeElapsed: mockTimerGetTimeElapsed,
  })),
  isExamPassed: vi.fn().mockReturnValue(false),
}));

import {
  loadExamQuestions,
  selectExamQuestions,
  selectQuestionsForMode,
  ExamTimer,
  createExamConfig,
  calculateExamScore,
} from "@/utils/examEngine";

// ============================================================================
// lucide-react mock (explicit named exports to avoid Proxy hang)
// ============================================================================

vi.mock("lucide-react", () => ({
  X: (props: Record<string, unknown>) => (
    <svg data-testid="icon-X" {...props} />
  ),
  Clock: (props: Record<string, unknown>) => (
    <svg data-testid="icon-Clock" {...props} />
  ),
  Flag: (props: Record<string, unknown>) => (
    <svg data-testid="icon-Flag" {...props} />
  ),
  ChevronLeft: (props: Record<string, unknown>) => (
    <svg data-testid="icon-ChevronLeft" {...props} />
  ),
  ChevronRight: (props: Record<string, unknown>) => (
    <svg data-testid="icon-ChevronRight" {...props} />
  ),
  CheckCircle: (props: Record<string, unknown>) => (
    <svg data-testid="icon-CheckCircle" {...props} />
  ),
}));

// ============================================================================
// Component import (after mocks)
// ============================================================================

import { ExamWorkspace } from "../ExamWorkspace";

// ============================================================================
// Helper: render with questions loaded
// ============================================================================

async function renderWithQuestions(onCloseFn: () => void) {
  vi.mocked(loadExamQuestions).mockResolvedValue(mockQuestions);
  vi.mocked(selectExamQuestions).mockReturnValue(mockQuestions);
  vi.mocked(selectQuestionsForMode).mockReturnValue(mockQuestions);

  // Pre-populate mockActiveExam so the component sees exam state
  mockActiveExam = {
    examId: "ncp-aii-practice",
    startTime: Date.now(),
    timeRemaining: 90 * 60,
    answers: {},
    currentQuestionIndex: 0,
    flaggedQuestions: [],
    answeredQuestions: [],
    submitted: false,
  };

  const result = render(<ExamWorkspace onClose={onCloseFn} />);

  // Wait for the loading screen to disappear
  await waitFor(() => {
    expect(
      screen.queryByText("Loading exam questions..."),
    ).not.toBeInTheDocument();
  });

  return result;
}

// ============================================================================
// Tests
// ============================================================================

describe("ExamWorkspace", () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveExam = null;
    mockExamAttempts = [];

    // Default: loadExamQuestions returns empty so loading state stays
    vi.mocked(loadExamQuestions).mockResolvedValue([]);
    vi.mocked(selectExamQuestions).mockReturnValue([]);
    vi.mocked(selectQuestionsForMode).mockReturnValue([]);
  });

  it("passes the latest incorrect questions and weak domains to the exam configuration", async () => {
    const previous = vi.mocked(calculateExamScore)([], {});
    mockExamAttempts = [previous];
    vi.mocked(loadExamQuestions).mockResolvedValue(mockQuestions);
    vi.mocked(selectQuestionsForMode).mockReturnValue(mockQuestions);
    render(<ExamWorkspace onClose={onClose} mode="review-mode" />);
    await waitFor(() => expect(mockTimerStart).toHaveBeenCalled());
    expect(createExamConfig).toHaveBeenCalledWith("review-mode", {
      reviewQuestionIds: ["q2"],
      weakDomains: ["domain2"],
    });
  });

  it("shows a closeable empty state when there are no questions to review", async () => {
    render(<ExamWorkspace onClose={onClose} mode="review-mode" />);
    await screen.findByText(/no incorrect answers from your latest exam/i);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
    expect(mockTimerStart).not.toHaveBeenCalled();
  });

  it("does not start a countdown for an untimed review", async () => {
    const config = vi.mocked(createExamConfig)("full-practice");
    vi.mocked(createExamConfig).mockReturnValue({
      ...config,
      mode: "review-mode",
      timeLimitMinutes: 0,
    });
    vi.mocked(loadExamQuestions).mockResolvedValue(mockQuestions);
    vi.mocked(selectQuestionsForMode).mockReturnValue(mockQuestions);
    const view = render(<ExamWorkspace onClose={onClose} mode="review-mode" />);
    await screen.findByText("No time limit");
    expect(mockTimerStart).not.toHaveBeenCalled();
    view.unmount();
    vi.mocked(createExamConfig).mockReturnValue(config);
  });

  it("opens the labs view when Review Labs is selected from results", async () => {
    const onReviewLabs = vi.fn();
    const view = await renderWithQuestions(onClose);
    mockActiveExam!.breakdown = vi.mocked(calculateExamScore)([], {});
    view.rerender(
      <ExamWorkspace onClose={onClose} onReviewLabs={onReviewLabs} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "3" }));
    fireEvent.click(screen.getByRole("button", { name: /submit exam/i }));
    fireEvent.click(screen.getByRole("button", { name: "Review Labs" }));
    expect(onClose).toHaveBeenCalled();
    expect(onReviewLabs).toHaveBeenCalled();
  });

  it("submits the current exam when the timer expires and stops the timer on unmount", async () => {
    vi.mocked(loadExamQuestions).mockResolvedValue(mockQuestions);
    vi.mocked(selectQuestionsForMode).mockReturnValue(mockQuestions);
    const view = render(<ExamWorkspace onClose={onClose} mode="quick-quiz" />);
    await waitFor(() => expect(mockTimerStart).toHaveBeenCalled());
    mockActiveExam = {
      examId: "ncp-aii-practice",
      startTime: Date.now(),
      timeRemaining: 0,
      answers: { q1: 0 },
      currentQuestionIndex: 0,
      flaggedQuestions: [],
      answeredQuestions: ["q1"],
      submitted: false,
    };
    view.rerender(<ExamWorkspace onClose={onClose} mode="quick-quiz" />);
    const onExpire = mockTimerStart.mock.calls[0][1];
    act(() => onExpire());
    expect(mockAddExamAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "quick-quiz", timeSpent: 120 }),
    );
    expect(mockEndExam).toHaveBeenCalled();
    view.unmount();
    expect(mockTimerStop).toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // Basic rendering & loading
  // --------------------------------------------------------------------------

  it("renders without crashing", () => {
    const { container } = render(<ExamWorkspace onClose={onClose} />);
    expect(container.firstChild).toBeTruthy();
  });

  it("shows loading state initially before questions load", () => {
    render(<ExamWorkspace onClose={onClose} />);
    expect(screen.getByText("Loading exam questions...")).toBeInTheDocument();
  });

  it("renders as a fixed full-screen overlay", () => {
    const { container } = render(<ExamWorkspace onClose={onClose} />);
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain("fixed");
    expect(root.className).toContain("inset-0");
    expect(root.className).toContain("z-50");
  });

  // --------------------------------------------------------------------------
  // After questions load
  // --------------------------------------------------------------------------

  it("shows the exam title after questions load", async () => {
    await renderWithQuestions(onClose);
    expect(screen.getByText("NCP-AII Practice Exam")).toBeInTheDocument();
  });

  it("calls startExam on the store when questions load", async () => {
    await renderWithQuestions(onClose);
    expect(mockStartExam).toHaveBeenCalledWith("ncp-aii-practice");
  });

  // --------------------------------------------------------------------------
  // Exit button
  // --------------------------------------------------------------------------

  it("shows exit button with title 'Exit Exam'", async () => {
    await renderWithQuestions(onClose);
    expect(screen.getByTitle("Exit Exam")).toBeInTheDocument();
  });

  it("calls exitExam and onClose when exit button is clicked", async () => {
    await renderWithQuestions(onClose);
    fireEvent.click(screen.getByTitle("Exit Exam"));
    expect(mockExitExam).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // --------------------------------------------------------------------------
  // Question display
  // --------------------------------------------------------------------------

  it("shows the first question text", async () => {
    await renderWithQuestions(onClose);
    expect(
      screen.getByText("What command checks GPU status?"),
    ).toBeInTheDocument();
  });

  it("shows the domain badge for the current question", async () => {
    await renderWithQuestions(onClose);
    expect(screen.getByText("DOMAIN1")).toBeInTheDocument();
  });

  it("shows answer choices for the current question", async () => {
    await renderWithQuestions(onClose);
    expect(screen.getByText("nvidia-smi")).toBeInTheDocument();
    expect(screen.getByText("lspci")).toBeInTheDocument();
    expect(screen.getByText("dmesg")).toBeInTheDocument();
    expect(screen.getByText("top")).toBeInTheDocument();
  });

  it("renders radio inputs for single-choice questions", async () => {
    await renderWithQuestions(onClose);
    const radios = screen.getAllByRole("radio");
    expect(radios.length).toBe(4);
  });

  // --------------------------------------------------------------------------
  // Progress indicator
  // --------------------------------------------------------------------------

  it("shows question progress (current/total)", async () => {
    await renderWithQuestions(onClose);
    expect(screen.getByText(/Question 1 of 3/)).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Timer display
  // --------------------------------------------------------------------------

  it("shows the timer display with initial 90:00", async () => {
    await renderWithQuestions(onClose);
    expect(screen.getByText("90:00")).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Answer selection
  // --------------------------------------------------------------------------

  it("calls submitExamAnswer when an answer is selected", async () => {
    await renderWithQuestions(onClose);
    const radios = screen.getAllByRole("radio");
    fireEvent.click(radios[1]); // Click second option (lspci)
    expect(mockSubmitExamAnswer).toHaveBeenCalledWith("q1", 1);
  });

  // --------------------------------------------------------------------------
  // Navigation: Next / Previous
  // --------------------------------------------------------------------------

  it("advances to next question when Next is clicked", async () => {
    await renderWithQuestions(onClose);
    expect(screen.getByText("Next")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText(/Question 2 of 3/)).toBeInTheDocument();
    expect(
      screen.getByText("Which tool monitors InfiniBand?"),
    ).toBeInTheDocument();
  });

  it("navigates back when Previous is clicked", async () => {
    await renderWithQuestions(onClose);
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText(/Question 2 of 3/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Previous"));
    expect(screen.getByText(/Question 1 of 3/)).toBeInTheDocument();
  });

  it("Previous button is disabled on the first question", async () => {
    await renderWithQuestions(onClose);
    const prevButton = screen.getByText("Previous").closest("button")!;
    expect(prevButton).toBeDisabled();
  });

  // --------------------------------------------------------------------------
  // Submit Exam button on last question
  // --------------------------------------------------------------------------

  it("shows Submit Exam button on the last question instead of Next", async () => {
    await renderWithQuestions(onClose);
    fireEvent.click(screen.getByText("Next")); // -> q2
    fireEvent.click(screen.getByText("Next")); // -> q3
    expect(screen.getByText(/Question 3 of 3/)).toBeInTheDocument();
    expect(screen.getByText("Submit Exam")).toBeInTheDocument();
    expect(screen.queryByText("Next")).not.toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Sidebar question navigation
  // --------------------------------------------------------------------------

  it("shows question navigation grid in sidebar", async () => {
    await renderWithQuestions(onClose);
    expect(screen.getByText("QUESTION NAVIGATION")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("navigates to a specific question via sidebar button", async () => {
    await renderWithQuestions(onClose);
    const navButtons = screen
      .getAllByRole("button")
      .filter((btn) => btn.textContent === "3");
    fireEvent.click(navButtons[0]);
    expect(screen.getByText(/Question 3 of 3/)).toBeInTheDocument();
    expect(
      screen.getByText("Select all DCGM diagnostic levels."),
    ).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Multiple-select question type
  // --------------------------------------------------------------------------

  it("renders checkboxes and helper text for multiple-select questions", async () => {
    await renderWithQuestions(onClose);
    fireEvent.click(screen.getByText("Next")); // -> q2
    fireEvent.click(screen.getByText("Next")); // -> q3
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.length).toBe(4);
    expect(screen.getByText("Select all that apply")).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Flag for review
  // --------------------------------------------------------------------------

  it("shows Flag for Review button in sidebar", async () => {
    await renderWithQuestions(onClose);
    expect(screen.getByText("Flag for Review")).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Answered status
  // --------------------------------------------------------------------------

  it("shows 'Not answered' status for unanswered questions", async () => {
    await renderWithQuestions(onClose);
    expect(screen.getByText("Not answered")).toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // ExamTimer lifecycle
  // --------------------------------------------------------------------------

  it("creates and starts an ExamTimer on mount", async () => {
    await renderWithQuestions(onClose);
    expect(ExamTimer).toHaveBeenCalledWith(90 * 60);
    expect(mockTimerStart).toHaveBeenCalledTimes(1);
  });

  // --------------------------------------------------------------------------
  // Timer stop on exit
  // --------------------------------------------------------------------------

  it("stops the timer when exit button is clicked", async () => {
    await renderWithQuestions(onClose);
    fireEvent.click(screen.getByTitle("Exit Exam"));
    expect(mockTimerStop).toHaveBeenCalledTimes(1);
  });
});
