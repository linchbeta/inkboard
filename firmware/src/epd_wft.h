/**
  ******************************************************************************
  * @file    epd_wft.h
  * @brief   Waveshare EPD driver for WFT042 4.2" panels (adapted for InkSight)
  *          Only compiled when EPD_PANEL_42_WFT is defined.
  ******************************************************************************
  */
#ifdef EPD_PANEL_42_WFT
#ifndef EPD_WFT_H
#define EPD_WFT_H
/* SPI pin definition --------------------------------------------------------*/
#include "config.h"

#define PIN_SPI_DIN  PIN_EPD_MOSI
#define PIN_SPI_SCK  PIN_EPD_SCK
#define PIN_SPI_CS   PIN_EPD_CS
#define PIN_SPI_DC   PIN_EPD_DC
#define PIN_SPI_RST  PIN_EPD_RST
#define PIN_SPI_BUSY PIN_EPD_BUSY

/* Pin level definition ------------------------------------------------------*/
// #define LOW             0
// #define HIGH            1

#define GPIO_PIN_SET   1
#define GPIO_PIN_RESET 0

void EPD_initSPI()
{
    pinMode(PIN_SPI_BUSY,  INPUT);
    pinMode(PIN_SPI_RST , OUTPUT);
    pinMode(PIN_SPI_DC  , OUTPUT);
    
    pinMode(PIN_SPI_SCK, OUTPUT);
    pinMode(PIN_SPI_DIN, OUTPUT);
    pinMode(PIN_SPI_CS , OUTPUT);

    digitalWrite(PIN_SPI_RST, HIGH);
    digitalWrite(PIN_SPI_CS, HIGH);
    digitalWrite(PIN_SPI_SCK, LOW);
}

void GPIO_Mode(unsigned char GPIO_Pin, unsigned char Mode)
{
    if(Mode == 0) {
        pinMode(GPIO_Pin , INPUT);
	} else {
		pinMode(GPIO_Pin , OUTPUT);
	}
}

/* Lut mono ------------------------------------------------------------------*/
byte lut_full_mono[] =
{
    0x02, 0x02, 0x01, 0x11, 0x12, 0x12, 0x22, 0x22, 
    0x66, 0x69, 0x69, 0x59, 0x58, 0x99, 0x99, 0x88, 
    0x00, 0x00, 0x00, 0x00, 0xF8, 0xB4, 0x13, 0x51, 
    0x35, 0x51, 0x51, 0x19, 0x01, 0x00
};

byte lut_partial_mono[] =
{
    0x10, 0x18, 0x18, 0x08, 0x18, 0x18, 0x08, 0x00, 
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 
    0x00, 0x00, 0x00, 0x00, 0x13, 0x14, 0x44, 0x12, 
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00
};

/* The procedure of sending a byte to e-Paper by SPI -------------------------*/
void EpdSpiTransferCallback(byte data) 
{
    for (int i = 0; i < 8; i++)
    {
        if ((data & 0x80) == 0) digitalWrite(PIN_SPI_DIN, GPIO_PIN_RESET); 
        else                    digitalWrite(PIN_SPI_DIN, GPIO_PIN_SET);

        data <<= 1;
        digitalWrite(PIN_SPI_SCK, GPIO_PIN_SET);
        digitalWrite(PIN_SPI_SCK, GPIO_PIN_RESET);
    }
}


unsigned char DEV_SPI_ReadByte()
{
    unsigned char j=0xff;
    GPIO_Mode(PIN_SPI_DIN, 0);
    digitalWrite(PIN_SPI_CS, GPIO_PIN_RESET);
    for (int i = 0; i < 8; i++)
    {
        j = j << 1;
        if (digitalRead(PIN_SPI_DIN))  j = j | 0x01;
        else                            j = j & 0xfe;
        
        digitalWrite(PIN_SPI_SCK, GPIO_PIN_SET);     
        digitalWrite(PIN_SPI_SCK, GPIO_PIN_RESET);
    }
    digitalWrite(PIN_SPI_CS, GPIO_PIN_SET);
    GPIO_Mode(PIN_SPI_DIN, 1);
    return j;
}

byte lut_vcom0[] = { 15, 0x0E, 0x14, 0x01, 0x0A, 0x06, 0x04, 0x0A, 0x0A, 0x0F, 0x03, 0x03, 0x0C, 0x06, 0x0A, 0x00 };
byte lut_w    [] = { 15, 0x0E, 0x14, 0x01, 0x0A, 0x46, 0x04, 0x8A, 0x4A, 0x0F, 0x83, 0x43, 0x0C, 0x86, 0x0A, 0x04 };
byte lut_b    [] = { 15, 0x0E, 0x14, 0x01, 0x8A, 0x06, 0x04, 0x8A, 0x4A, 0x0F, 0x83, 0x43, 0x0C, 0x06, 0x4A, 0x04 };
byte lut_g1   [] = { 15, 0x8E, 0x94, 0x01, 0x8A, 0x06, 0x04, 0x8A, 0x4A, 0x0F, 0x83, 0x43, 0x0C, 0x06, 0x0A, 0x04 };
byte lut_g2   [] = { 15, 0x8E, 0x94, 0x01, 0x8A, 0x06, 0x04, 0x8A, 0x4A, 0x0F, 0x83, 0x43, 0x0C, 0x06, 0x0A, 0x04 };
byte lut_vcom1[] = { 15, 0x03, 0x1D, 0x01, 0x01, 0x08, 0x23, 0x37, 0x37, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00 };
byte lut_red0 [] = { 15, 0x83, 0x5D, 0x01, 0x81, 0x48, 0x23, 0x77, 0x77, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00 };
byte lut_red1 [] = { 15, 0x03, 0x1D, 0x01, 0x01, 0x08, 0x23, 0x37, 0x37, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00 };

/* Sending a byte as a command -----------------------------------------------*/
void EPD_SendCommand(byte command) 
{
    digitalWrite(PIN_SPI_DC, LOW);
    digitalWrite(PIN_SPI_CS, GPIO_PIN_RESET);
    EpdSpiTransferCallback(command);
    digitalWrite(PIN_SPI_CS, GPIO_PIN_SET);
}

void EPD_SendCommand_13in3E6(byte command) 
{
    digitalWrite(PIN_SPI_DC, LOW);
    //SPI.beginTransaction(spi_settings);
    for (int i = 0; i < 8; i++)
    {
        if ((command & 0x80) == 0) digitalWrite(PIN_SPI_DIN, GPIO_PIN_RESET); 
        else                    digitalWrite(PIN_SPI_DIN, GPIO_PIN_SET);

        command <<= 1;
        digitalWrite(PIN_SPI_SCK, GPIO_PIN_SET);
        digitalWrite(PIN_SPI_SCK, GPIO_PIN_RESET);
    }
    
    //SPI.transfer(command);
    //SPI.endTransaction();
}

/* Sending a byte as a data --------------------------------------------------*/
void EPD_SendData(byte data) 
{
    digitalWrite(PIN_SPI_DC, HIGH);
    digitalWrite(PIN_SPI_CS, GPIO_PIN_RESET);
    EpdSpiTransferCallback(data);
    digitalWrite(PIN_SPI_CS, GPIO_PIN_SET);
}

void EPD_SendData_13in3E6(byte data) 
{
    digitalWrite(PIN_SPI_DC, HIGH);
    //SPI.beginTransaction(spi_settings);
    for (int i = 0; i < 8; i++)
    {
        if ((data & 0x80) == 0) digitalWrite(PIN_SPI_DIN, GPIO_PIN_RESET); 
        else                    digitalWrite(PIN_SPI_DIN, GPIO_PIN_SET);

        data <<= 1;
        digitalWrite(PIN_SPI_SCK, GPIO_PIN_SET);
        digitalWrite(PIN_SPI_SCK, GPIO_PIN_RESET);
    }
    
    //SPI.transfer(data);
    //SPI.endTransaction();
}

/* Waiting the e-Paper is ready for further instructions ---------------------
 */
void EPD_WaitUntilIdle() 
{
    //0: busy, 1: idle
    int timeout = 0;
    Serial.println("EPD_WaitUntilIdle: waiting");
    while(digitalRead(PIN_SPI_BUSY) == 0) {
        delay(100);
        timeout++;
        if (timeout > 100) { // 10 seconds timeout
            Serial.println("EPD_WaitUntilIdle timeout!");
            break;
        }
    }    
    Serial.println("EPD_WaitUntilIdle: done");
}

/* Waiting the e-Paper is ready for further instructions ---------------------*/
void EPD_WaitUntilIdle_high() 
{
    //1: busy, 0: idle
    while(digitalRead(PIN_SPI_BUSY) == 1) delay(100);    
}

/* Send a one-argument command -----------------------------------------------*/
void EPD_Send_1(byte c, byte v1)
{
    EPD_SendCommand(c);
    EPD_SendData(v1);
}

/* Send a two-arguments command ----------------------------------------------*/
void EPD_Send_2(byte c, byte v1, byte v2)
{
    EPD_SendCommand(c);
    EPD_SendData(v1);
    EPD_SendData(v2);
}

/* Send a three-arguments command --------------------------------------------*/
void EPD_Send_3(byte c, byte v1, byte v2, byte v3)
{
    EPD_SendCommand(c);
    EPD_SendData(v1);
    EPD_SendData(v2);
    EPD_SendData(v3);
}

/* Send a four-arguments command ---------------------------------------------*/
void EPD_Send_4(byte c, byte v1, byte v2, byte v3, byte v4)
{
    EPD_SendCommand(c);
    EPD_SendData(v1);
    EPD_SendData(v2);
    EPD_SendData(v3);
    EPD_SendData(v4);
}

/* Send a five-arguments command ---------------------------------------------*/
void EPD_Send_5(byte c, byte v1, byte v2, byte v3, byte v4, byte v5)
{
    EPD_SendCommand(c);
    EPD_SendData(v1);
    EPD_SendData(v2);
    EPD_SendData(v3);
    EPD_SendData(v4);
    EPD_SendData(v5);
}

/* Writting lut-data into the e-Paper ----------------------------------------*/
void EPD_lut(byte c, byte l, byte*p)
{
    // lut-data writting initialization
    EPD_SendCommand(c);

    // lut-data writting doing
    for (int i = 0; i < l; i++, p++) EPD_SendData(*p);
}

/* Writting lut-data of the black-white channel ------------------------------*/
void EPD_SetLutBw(byte*c20, byte*c21, byte*c22, byte*c23, byte*c24) 
{
    EPD_lut(0x20, *c20, c20 + 1);//g vcom 
    EPD_lut(0x21, *c21, c21 + 1);//g ww -- 
    EPD_lut(0x22, *c22, c22 + 1);//g bw r
    EPD_lut(0x23, *c23, c23 + 1);//g wb w
    EPD_lut(0x24, *c24, c24 + 1);//g bb b
}

/* Writting lut-data of the red channel --------------------------------------*/
void EPD_SetLutRed(byte*c25, byte*c26, byte*c27) 
{
    EPD_lut(0x25, *c25, c25 + 1);
    EPD_lut(0x26, *c26, c26 + 1);
    EPD_lut(0x27, *c27, c27 + 1);
}

/* This function is used to 'wake up" the e-Paper from the deep sleep mode ---*/
void EPD_Reset() 
{
    digitalWrite(PIN_SPI_RST, HIGH); 
    delay(200);    
    digitalWrite(PIN_SPI_RST, LOW);    
    delay(2);
    digitalWrite(PIN_SPI_RST, HIGH); 
    delay(200);    
}

bool EPD_invert;           // If true, then image data bits must be inverted
int  EPD_dispIndex;        // The index of the e-Paper's type
int  EPD_dispX, EPD_dispY; // Current pixel's coordinates (for 2.13 only)
void(*EPD_dispLoad)();     // Pointer on a image data writting function

// Forward declarations
void EPD_loadA();
void EPD_loadAFilp();

/* e-Paper initialization functions ------------------------------------------*/ 
#include "epd4in2_wft.h"

/* Image data loading function for a-type e-Paper ----------------------------*/ 
void EPD_loadA()
{
    Serial.printf("EPD_loadA\r\n");
    // This function is not used in our project
}

void EPD_loadAFilp()
{
    Serial.printf("EPD_loadAFilp\r\n");
    // This function is not used in our project
}

/* Image data loading function for b-type e-Paper ----------------------------*/
void EPD_loadB()
{
      Serial.printf("EPD_loadB\r\n");
    // This function is not used in our project
}

/* Image data loading function for 2.13 e-Paper ------------------------------*/
void EPD_loadC()
{
       Serial.printf("EPD_loadC\r\n");
    // This function is not used in our project
}

/* Image data loading function for 7.5 e-Paper -------------------------------*/
void EPD_loadD()
{
      Serial.printf("EPD_loadD\r\n");
    // This function is not used in our project
}

/* Image data loading function for 7.5b e-Paper ------------------------------*/
void EPD_loadE()
{
       Serial.printf("EPD_loadE\r\n");
    // This function is not used in our project
}

/* Image data loading function for 5.83b e-Paper -----------------------------*/
void EPD_loadF()
{
       Serial.printf("EPD_loadF\r\n");
    // This function is not used in our project
}

/* Image data loading function for 5.65f e-Paper -----------------------------*/
void EPD_loadG()
{
      Serial.printf("EPD_loadG\r\n");
    // This function is not used in our project
}

void EPD_load_13in3E6()
{
       Serial.printf("EPD_load_13in3E6\r\n");
    // This function is not used in our project
}

/* Show image and turn to deep sleep mode (a-type, 4.2 and 2.7 e-Paper) ------*/
void EPD_showA() 
{
      Serial.printf("EPD_showA\r\n");
    // Refresh
    EPD_Send_1(0x22, 0xC4);// DISPLAY_UPDATE_CONTROL_2
    EPD_SendCommand( 0x20);// MASTER_ACTIVATION
    EPD_SendCommand( 0xFF);// TERMINATE_FRAME_READ_WRITE
    EPD_WaitUntilIdle();

    // Sleep
    EPD_SendCommand(0x10);// DEEP_SLEEP_MODE
    EPD_WaitUntilIdle();
}

/* Show image and turn to deep sleep mode (b-type, e-Paper) ------------------*/
void EPD_showB() 
{
      Serial.printf("EPD_showB\r\n");
    // Refresh
    EPD_SendCommand(0x12);// DISPLAY_REFRESH
    delay(100);
    EPD_WaitUntilIdle();

    // Sleep
    EPD_Send_1(0x50, 0x17);// VCOM_AND_DATA_INTERVAL_SETTING
    EPD_Send_1(0x82, 0x00);// VCM_DC_SETTING_REGISTER, to solve Vcom drop
    EPD_Send_4(0x01, 0x02, 0x00, 0x00, 0x00);// POWER_SETTING
    EPD_WaitUntilIdle();
    EPD_SendCommand(0x02);// POWER_OFF
}

/* Show image and turn to deep sleep mode (7.5 and 7.5b e-Paper) -------------*/
void EPD_showC() 
{
      Serial.printf("EPD_showC\r\n");
    // Refresh
    EPD_SendCommand(0x12);// DISPLAY_REFRESH
    delay(100);
    EPD_WaitUntilIdle();

    // Sleep
    EPD_SendCommand(0x02);// POWER_OFF
    EPD_WaitUntilIdle();
    EPD_Send_1(0x07, 0xA5);// DEEP_SLEEP
}

// EPD_showD function removed - only using 4.2 inch e-paper

/* The set of pointers on 'init', 'load' and 'show' functions, title and code */
struct EPD_dispInfo
{
    int(*init)(); // Initialization
    void(*chBk)();// Black channel loading
    int next;     // Change channel code
    void(*chRd)();// Red channel loading
    void(*show)();// Show and sleep
    const char*title;   // Title of an e-Paper
};

/* Array of sets describing the usage of e-Papers ----------------------------*/
EPD_dispInfo EPD_dispMass[] =
{
    { EPD_Init_4in2,		EPD_loadA,		-1  ,	0,				EPD_showB,			"4.2 inch"		},// N 13
    { EPD_Init_4in2b,		EPD_loadA,		0x13,	EPD_loadA,		EPD_showB,  		"4.2 inch b"	},// O 14
};

/* Initialization of an e-Paper ----------------------------------------------*/
void EPD_dispInit()
{
      Serial.printf("EPD_dispInit %d\r\n", EPD_dispIndex);
    // Call initialization function
    EPD_dispMass[EPD_dispIndex].init();

    // Set loading function for black channel
    EPD_dispLoad = EPD_dispMass[EPD_dispIndex].chBk;

    // Set initial coordinates
    EPD_dispX = 0;
    EPD_dispY = 0;

    // The inversion of image data bits isn't needed by default
    EPD_invert = false;
}

#endif // EPD_WFT_H
#endif // EPD_PANEL_42_WFT