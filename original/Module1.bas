' Extracted from "SnF - v4.xls" (Module1) for reference. Not run by the app.
Option Compare Text
Option Explicit
'Workbook
Dim wb As Workbook
'Worksheets
Dim ws1 As Worksheet
Dim ws2 As Worksheet
'Offsets
Const yOs As Integer = 1
Const xOs As Integer = 1
'No in Pond
Dim FN As Integer
Dim SN As Integer
'Breeding Age
Dim FBA As Integer
Dim SBA As Integer
'Age Limits
Dim FAL As Integer
Dim SAL As Integer
'Startvation Rate
Dim SR As Integer
'Iterations
Dim It As Integer
'Locations
Dim Pond As Range
Dim NumGraph As Range
Dim AgeGraph As Range
Dim Pi_Max As Range
Const UB As Integer = 21
Const LB As Integer = 1
Dim y As Integer
Dim x As Integer
'Colors
Const SCr As Integer = 3
Const FCr As Integer = 41
'RN
Dim RN As Integer
'Advanced
Type PondCreature
    Family As Integer
    Status As Integer 'Status 0=Dead,1=Alice
    Age As Integer
    BreedAge As Integer
    MaxAge As Integer
    EnergyLvl As Integer
    EnergyRefresh As Integer
    Color As Integer
    y As Integer
    x As Integer
    Li As Integer
End Type
Type Location
    y As Integer
    x As Integer
    Pi As Integer
End Type
Dim PAT(5000) As PondCreature
Dim LocA(441) As Location
Dim Pi As Integer '
Dim Li As Integer
'Options
Const Graphics As Boolean = True
Const NumGraphics As Boolean = True
Const AgeGraphics As Boolean = False
'Monitoring
Dim STime As Double
Dim ETime As Double
Sub SetVar()
'Workbook
Set wb = ThisWorkbook
'Worksheet
Set ws1 = wb.Worksheets("1")
Set ws2 = wb.Worksheets("2")
'Numbers
FN = Cells(2, 26)
SN = Cells(3, 26)
'Breeding Age
FBA = Cells(7, 26)
SBA = Cells(8, 26)
'Age Limits
FAL = Cells(11, 26)
SAL = Cells(12, 26)
'Startvation Rate
SR = Cells(15, 26)
'Iterations
It = Cells(18, 26)
'Locations
Set Pond = Range("B2", "v22")
Set NumGraph = Range("AC2", "AE1000")
Set AgeGraph = Range("AG2", "AI5002")
Set Pi_Max = Cells(20, 26)
'Advanced
For y = LB + yOs To UB + yOs
    For x = LB + xOs To UB + xOs
        GetLi Li, y - yOs, x - xOs
        LocA(Li).y = y
        LocA(Li).x = x
        LocA(Li).Pi = 0
    Next x
Next y
End Sub
Sub Start()
STime = Timer
SetVar
Pond.Clear
Pi_Max = 0
Pi = 0
Do While (FN + SN) > 0
    RN = Int((2 - 1 + 1) * Rnd + 1) '1 = F or 2 = S
    Do
        RandomLoc Li
    Loop While LocA(Li).Pi <> 0
    Select Case RN
    Case 1 And FN > 0
        FN = FN - 1
        Breed RN, Pi, Li
    Case 2 And SN > 0
        SN = SN - 1
        Breed RN, Pi, Li
    End Select
Loop
If Graphics = False Then
    Pond.Clear
    DrawPAT
End If
ReadOut Pi
ETime = Timer
Cells(26, 26) = STime
Cells(26, 27) = ETime
End Sub
Sub RandomLoc(ByRef Li As Integer)
    GetLi Li, Int(UB * Rnd + LB), Int(UB * Rnd + LB)
End Sub
Sub Breed(RN As Integer, Pi, Li)
Pi_Max = Pi_Max + 1
Pi = Pi_Max
Select Case RN
Case 1
    PAT(Pi).BreedAge = FBA
    PAT(Pi).MaxAge = FAL
    PAT(Pi).EnergyLvl = 1
    PAT(Pi).EnergyRefresh = 0
    PAT(Pi).Color = FCr
Case 2
    PAT(Pi).BreedAge = SBA
    PAT(Pi).MaxAge = SAL
    PAT(Pi).EnergyLvl = SR
    PAT(Pi).EnergyRefresh = SR
    PAT(Pi).Color = SCr
End Select
PAT(Pi).Family = RN
PAT(Pi).Status = 1
PAT(Pi).Age = 1
SwapPL Pi, Li
If Graphics = True Then
    Li = PAT(Pi).Li
    Cells(LocA(Li).y, LocA(Li).x).Interior.ColorIndex = PAT(Pi).Color
End If
End Sub
Sub Age(Pi)
    PAT(Pi).Age = PAT(Pi).Age + 1
End Sub
Sub AllMove()
Dim nF As Integer
Dim nS As Integer
Dim Its As Integer
Dim NGr As Integer
STime = Timer
SetVar
NumGraph.Clear
AgeGraph.Clear
NGr = 2
ReadIn
For Its = 1 To It
    nF = 0
    nS = 0
    For Pi = 1 To Pi_Max
        If AgeGraphics = True Then
            Cells(Pi + 1, 33) = Pi
            Cells(Pi + 1, 33 + PAT(Pi).Family) = PAT(Pi).Age
        End If
        If PAT(Pi).Status = 1 Then
            If NumGraphics = True Then
                Select Case PAT(Pi).Family
                Case 1
                    nF = nF + 1
                Case 2
                    nS = nS + 1
                End Select
            End If
            Flow Pi
        Else
            If AgeGraphics = True Then
                Cells(Pi + 1, 33 + PAT(Pi).Family) = 0
            End If
        End If
    Next Pi
    If NumGraphics = True Then
        If NGr = 50 Then
            NGr = 2
        End If
        Cells(NGr, 29) = Its
        Cells(NGr, 30) = nF
        Cells(NGr, 31) = nS
        NGr = NGr + 1
        If nF = 0 Or nS = 0 Then
            Exit For
        End If
    End If
Next Its
If Graphics = False Then
    Pond.Clear
    DrawPAT
End If
ReadOut Pi
ETime = Timer
Cells(27, 26) = STime
Cells(27, 27) = ETime
End Sub
Sub Flow(Pi)
    Dim intTry As Integer
    Dim Ny As Integer
    Dim Nx As Integer
    Dim NCreatures As Integer
    Dim Success As Boolean
        Success = False
        'Shark
        If PAT(Pi).Family = 2 Then
            If PAT(Pi).EnergyLvl < Round(PAT(Pi).EnergyRefresh * 0.6, 0) Then
                'Try to eat
                For intTry = 1 To 9
                    Direction Pi, Li, 1, intTry
                    If PAT(LocA(Li).Pi).Family = 1 Then
                        Success = True
                        Exit For
                    End If
                Next intTry
            Else
                'Try to Breed
                For intTry = 1 To 9
                    Direction Pi, Li, 2, intTry
                    If PAT(LocA(Li).Pi).Family = PAT(Pi).Family Then
                        Success = True
                        Exit For
                    End If
                Next intTry
            End If
        End If
        'All
        If Success = False Then
            Direction Pi, Li, 0
        End If
        If LocA(Li).Pi = 0 Then
            'Moving
            If Graphics = True Then
                Cells(LocA(Li).y, LocA(Li).x).Interior.ColorIndex = PAT(Pi).Color
                Cells(PAT(Pi).y, PAT(Pi).x).Interior.ColorIndex = xlNone
            End If
            SwapPL Pi, Li
            LocA(PAT(Pi).Li).Pi = 0
        Else
            'Sharks Eating
            If PAT(LocA(Li).Pi).Family <> PAT(Pi).Family And PAT(Pi).Family = 2 Then
                If Graphics = True Then
                    Cells(LocA(Li).y, LocA(Li).x).Interior.ColorIndex = xlNone
                End If
                PAT(LocA(Li).Pi).Status = 0
                LocA(Li).Pi = 0
                PAT(Pi).EnergyLvl = PAT(Pi).EnergyRefresh
            End If
            'Breeding
            intTry = 0
            If PAT(LocA(Li).Pi).Family <> PAT(Pi).Family Then
                If PAT(LocA(Li).Pi).Age >= PAT(LocA(Li).Pi).BreedAge And PAT(Pi).Age >= PAT(Pi).BreedAge Then
                    NCreatures = 1
                    Do
                        RandomLoc Li
                        If LocA(Li).Pi = 0 Then
                            Breed PAT(Pi).Family, Pi_Max, Li
                            NCreatures = NCreatures - 1
                        End If
                        intTry = intTry + 1
                    Loop While NCreatures > 0 And intTry < 5
                End If
            End If
        End If
        'Aging
        If PAT(Pi).Age > PAT(Pi).MaxAge Then
            KillDead Pi
        Else
            Age Pi
        End If
        'EnergyLvl
        If PAT(Pi).Family = 2 Then
            Select Case PAT(Pi).EnergyLvl
            Case Is <= 1
                KillDead Pi
            Case Else
                PAT(Pi).EnergyLvl = PAT(Pi).EnergyLvl - 1
            End Select
        End If
End Sub
Sub Direction(Pi, ByRef Li As Integer, Obj As Integer, Optional TNo As Integer)
Dim RD As Integer
Dim rT As Boolean

'Objective = 0 for None, 1 for Feed, 2 for Breed

Retry:
If Obj <> 0 Then
    If rT = True Then
        If RD = 9 Then
            Obj = 0
            RD = Int((9 - 1 + 1) * Rnd + 1)
        Else
            RD = RD + 1
        End If
    Else
        RD = TNo
    End If
Else
    RD = Int((9 - 1 + 1) * Rnd + 1)
End If

rT = False
If PAT(Pi).y <= LB + yOs And (RD = 1 Or RD = 2 Or RD = 3) Then
    rT = True
End If
If PAT(Pi).y >= UB + yOs And (RD = 7 Or RD = 8 Or RD = 9) Then
    rT = True
End If
If PAT(Pi).x <= LB + xOs And (RD = 1 Or RD = 4 Or RD = 7) Then
    rT = True
End If
If PAT(Pi).x >= UB + xOs And (RD = 3 Or RD = 6 Or RD = 9) Then
    rT = True
End If
   
If rT = True Then
    GoTo Retry
Else
' _ _ _
' 1 2 3
' 4 5 6
' 7 8 9
' _ _ _

    Select Case RD
    Case 1
        GetLi Li, PAT(Pi).y - 1, PAT(Pi).x - 1, True
    Case 2
        GetLi Li, PAT(Pi).y - 1, PAT(Pi).x, True
    Case 3
        GetLi Li, PAT(Pi).y - 1, PAT(Pi).x + 1, True
    Case 4
        GetLi Li, PAT(Pi).y, PAT(Pi).x - 1, True
    Case 5
        'GoTo Retry
        GetLi Li, PAT(Pi).y, PAT(Pi).x, True
    Case 6
        GetLi Li, PAT(Pi).y, PAT(Pi).x + 1, True
    Case 7
        GetLi Li, PAT(Pi).y + 1, PAT(Pi).x - 1, True
    Case 8
        GetLi Li, PAT(Pi).y + 1, PAT(Pi).x, True
    Case 9
        GetLi Li, PAT(Pi).y + 1, PAT(Pi).x + 1, True
    End Select
End If
End Sub
Function CountColor(InputRange As Range, ColorIndex As Integer)
Dim rCell As Range
Dim vResult
   For Each rCell In InputRange
    If rCell.Interior.ColorIndex = ColorIndex Then
         vResult = vResult + 1
    End If
   Next rCell
CountColor = vResult
End Function
Sub ReadIn()
Dim r As Integer
Dim ws As Worksheet
Set ws = ThisWorkbook.Worksheets("Data")
Pi = 1
r = 2
'Read in Only the live ones
Do While ws.Cells(r, 1) <> ""
    If ws.Cells(r, 3) = 1 Then
        PAT(Pi).Family = ws.Cells(r, 2)
        PAT(Pi).Status = ws.Cells(r, 3)
        PAT(Pi).Age = ws.Cells(r, 4)
        PAT(Pi).BreedAge = ws.Cells(r, 5)
        PAT(Pi).MaxAge = ws.Cells(r, 6)
        PAT(Pi).EnergyLvl = ws.Cells(r, 7)
        PAT(Pi).EnergyRefresh = ws.Cells(r, 8)
        PAT(Pi).Color = ws.Cells(r, 9)
        PAT(Pi).y = ws.Cells(r, 10)
        PAT(Pi).x = ws.Cells(r, 11)
        PAT(Pi).Li = ws.Cells(r, 12)
        LocA(ws.Cells(r, 12)).Pi = Pi
        Pi = Pi + 1
    End If
    r = r + 1
Loop
Pi_Max = Pi
End Sub
Sub ReadOut(r_end)
Dim r As Integer
Dim ws As Worksheet
Set ws = ThisWorkbook.Worksheets("Data")
ws.Range("A2", "L6000").Clear
For r = 0 To r_end
    ws.Cells(r + 2, 1) = r
    ws.Cells(r + 2, 2) = PAT(r).Family
    ws.Cells(r + 2, 3) = PAT(r).Status
    ws.Cells(r + 2, 4) = PAT(r).Age
    ws.Cells(r + 2, 5) = PAT(r).BreedAge
    ws.Cells(r + 2, 6) = PAT(r).MaxAge
    ws.Cells(r + 2, 7) = PAT(r).EnergyLvl
    ws.Cells(r + 2, 8) = PAT(r).EnergyRefresh
    ws.Cells(r + 2, 9) = PAT(r).Color
    ws.Cells(r + 2, 10) = PAT(r).y
    ws.Cells(r + 2, 11) = PAT(r).x
    ws.Cells(r + 2, 12) = PAT(r).Li
Next
End Sub
Sub GetLi(ByRef Li As Integer, y As Integer, x As Integer, Optional Offset As Boolean)
    If Offset = True Then
        Li = (y - yOs) + 21 * ((x - xOs) - 1)
    Else
        Li = y + 21 * (x - 1)
    End If
End Sub
Sub SwapPL(Pi, Li)
    PAT(Pi).Li = Li
    PAT(Pi).y = LocA(Li).y
    PAT(Pi).x = LocA(Li).x
    LocA(Li).Pi = Pi
End Sub
Sub DrawPAT()
    For Pi = 0 To Pi_Max
        If PAT(Pi).Status = 1 Then
            Cells(PAT(Pi).y, PAT(Pi).x).Interior.ColorIndex = PAT(Pi).Color
        End If
    Next Pi
End Sub
Sub KillDead(Pi)
    PAT(Pi).Status = 0
    LocA(PAT(Pi).Li).Pi = 0
    If Graphics = True Then
        Cells(PAT(Pi).y, PAT(Pi).x).Clear
    End If
End Sub
